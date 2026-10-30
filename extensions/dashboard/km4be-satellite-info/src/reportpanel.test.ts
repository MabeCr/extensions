// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The Report page of a pass, driven the way the host drives it: render, tap, render.

import assert from "node:assert/strict"
import { test } from "node:test"

import { ELEMENTS_URL, LIST_URL, statusUrl } from "./data.ts"
import { CATALOG, ELEMENTS, LIST, SUMMARY } from "./fixtures.ts"
import { forgetAll } from "./memory.ts"
import { CATALOG_URL, REPORTS_URL } from "./report.ts"
import { loadExtension } from "./sdkGapTesting.ts"

const ctx = { online: true }
let panes = 0
const t0 = Date.parse("2026-10-07T00:00:00Z")
const cfg = { grid: "EL95vs" }

interface Control {
  id: string
  kind: string
  label: string
  value?: string
  disabled?: boolean
  opacity?: number
  options?: { label: string; value: string }[]
}
interface Scene {
  values: Record<string, number>
  strings: Record<string, string>
  controls: Control[]
}
interface Posted {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

async function panel(options: { operation?: Record<string, unknown>; answer?: (posted: Posted) => { status: number; body: string }; noForm?: boolean } = {}) {
  forgetAll()
  const id = ++panes
  const storage = new Map<string, unknown>()
  const fetched: string[] = []
  const posted: Posted[] = []
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      getLocation: () => null,
      kvGet: (params) => storage.get(String(params.key)) ?? null,
      kvSet: (params) => void storage.set(String(params.key), params.value),
      fetch: (params) => {
        const url = String(params.url)
        fetched.push(url)
        if (url === REPORTS_URL) {
          const request = params as unknown as Posted
          posted.push(request)
          return (options.answer ?? (() => ({ status: 201, body: JSON.stringify({ data: { id: 1 } }) })))(request)
        }
        if (url === CATALOG_URL) return options.noForm ? { status: 500, body: "" } : { status: 200, body: JSON.stringify(CATALOG) }
        if (url === LIST_URL) return { status: 200, body: JSON.stringify(LIST) }
        if (url === ELEMENTS_URL) return { status: 200, body: JSON.stringify(ELEMENTS) }
        if (url === statusUrl(24)) return { status: 200, body: JSON.stringify(SUMMARY) }
        return { status: 404, body: "" }
      },
    },
  })
  const args = (at: number) => ({
    panelKey: "passes",
    instanceId: `pane-report-${id}`,
    operation: options.operation ?? { operatorCall: "km4be", stationCall: "W1AW" },
    qsoCount: 0,
    reason: "",
    config: cfg,
    clock: { nowMillis: at, realNowMillis: at },
  })
  const p = {
    fetched,
    posted,
    render: async (at: number) => ((await ext.runHook("panel", "render", args(at), { ctx })) as { scene: Scene }).scene,
    event: async (at: number, controlId: string, action: string, extra: { text?: string; value?: number } = {}) =>
      (await ext.runHook("panel", "onEvent", { ...args(at), event: { controlId, action, phase: "commit", sequence: 1, ...extra } }, { ctx })) as {
        values: Record<string, number>
        strings: Record<string, string>
      },
  }
  return p
}

/// Opens the first pass in the list and goes to its Report page.
async function openReport(p: Awaited<ReturnType<typeof panel>>, at = t0) {
  const list = await p.render(at)
  const open = list.controls.find((c) => c.id.startsWith("open:") && c.opacity !== 0)!
  await p.event(at, open.id, "open")
  await p.event(at, "tab", "tab", { text: "report" })
  return p.render(at)
}

const control = (scene: Scene, id: string) => scene.controls.find((c) => c.id === id)

test("the Report page starts from the operator's callsign and the grid the panel is using, and sends nothing yet", async () => {
  const p = await panel()
  const scene = await openReport(p)
  assert.equal(scene.strings.tab, "report")
  assert.equal(scene.strings.call, "KM4BE", "the operator, not the station")
  assert.equal(scene.strings.grid, "EL95vs")
  assert.equal(scene.strings.kind, "")
  assert.match(scene.strings.summary, /what you heard/)
  assert.equal(control(scene, "send")?.disabled, true, "nothing to send until what was heard is chosen")
  assert.ok(scene.controls.every((c) => c.kind.startsWith("native")))
  assert.ok(scene.controls.length <= 64)
  assert.equal(p.posted.length, 0)
  assert.ok(p.fetched.includes(CATALOG_URL), "AMSAT's catalog is read for its satellites")
})

test("the transponders offered are AMSAT's for this satellite, its own kind first", async () => {
  const p = await panel()
  const scene = await openReport(p)
  const options = control(scene, "variant")!.options!
  assert.ok(options.length >= 1 && options.length <= 2)
  assert.ok(options[0].value.endsWith("[U/v]") || options[0].value.endsWith("[V/u]"), options[0].value)
  assert.equal(scene.strings.variant, options[0].value)
})

test("the station's callsign is used when there is no operator, and none when there is neither", async () => {
  assert.equal((await openReport(await panel({ operation: { stationCall: "w1aw" } }))).strings.call, "W1AW")
  const blank = await openReport(await panel({ operation: {} }))
  assert.equal(blank.strings.call, "")
})

test("sending asks first, and only the second tap posts the report, once", async () => {
  const p = await panel()
  await openReport(p)
  assert.equal((await p.event(t0, "kind", "kind", { text: "heard" })).strings!.kind, "heard")
  const ready = await p.render(t0)
  assert.match(ready.strings.summary, /^(AO-7|FO-29) \[(U\/v|V\/u)\]: heard, 00:00–00:15Z, as KM4BE, EL95vs$/)
  assert.equal(control(ready, "send")?.disabled, false)

  await p.event(t0, "send", "send")
  assert.equal(p.posted.length, 0, "the first tap only asks")
  const sure = await p.render(t0)
  assert.ok(control(sure, "confirm") && control(sure, "cancel"))
  assert.equal(control(sure, "send"), undefined)

  await p.event(t0, "confirm", "confirm")
  assert.equal(p.posted.length, 1)
  const [post] = p.posted
  assert.equal(post.method, "POST")
  assert.equal(post.headers?.["Content-Type"], "application/json")
  const sent = JSON.parse(post.body!) as Record<string, string>
  assert.match(sent.name, /^(AO-7_\[U\/v\]|FO-29_\[V\/u\])$/)
  assert.deepEqual({ ...sent, name: "x" }, { name: "x", report: "Heard", callsign: "KM4BE", grid_square: "EL95vs", reported_at: "2026-10-07T00:00:00Z" })

  const after = await p.render(t0)
  assert.match(after.strings.message, /^Sent to AMSAT: /)
  assert.equal(after.strings.kind, "", "so a second tap cannot send the same report again")
  assert.equal(control(after, "send")?.disabled, true)

  // A tap on Yes that arrives after it was sent does nothing.
  await p.event(t0, "confirm", "confirm")
  assert.equal(p.posted.length, 1)
})

test("cancelling, or changing anything, takes back the request to send", async () => {
  const p = await panel()
  await openReport(p)
  await p.event(t0, "kind", "kind", { text: "notHeard" })
  await p.event(t0, "send", "send")
  assert.ok(control(await p.render(t0), "confirm"))
  await p.event(t0, "cancel", "cancel")
  assert.ok(control(await p.render(t0), "send"))

  await p.event(t0, "send", "send")
  await p.event(t0, "grid", "grid", { text: "fn31" })
  const changed = await p.render(t0)
  assert.ok(control(changed, "send"), "back to asking")
  assert.equal(changed.strings.grid, "FN31")
  await p.event(t0, "confirm", "confirm")
  assert.equal(p.posted.length, 0, "a confirm with nothing asked posts nothing")
})

test("the callsign can be changed before it is sent, and is tidied and checked", async () => {
  const p = await panel()
  await openReport(p)
  await p.event(t0, "kind", "kind", { text: "telemetry" })
  const patch = await p.event(t0, "call", "call", { text: " w8abe " })
  assert.equal(patch.strings.call, "W8ABE")
  assert.match(patch.strings.summary, /telemetry only, 00:00–00:15Z, as W8ABE/)

  const bad = await p.event(t0, "call", "call", { text: "banana" })
  assert.match(bad.strings.summary, /BANANA does not look like a callsign/)
  assert.equal(control(await p.render(t0), "send")?.disabled, true)

  await p.event(t0, "call", "call", { text: "w8abe" })
  await p.event(t0, "grid", "grid", { text: "" })
  await p.event(t0, "send", "send")
  await p.event(t0, "confirm", "confirm")
  const sent = JSON.parse(p.posted[0].body!) as Record<string, string>
  assert.deepEqual([sent.report, sent.callsign, "grid_square" in sent], ["Telemetry Only", "W8ABE", false], "no grid sent when it is empty")
})

test("the callsign stays for the next pass; what was heard does not", async () => {
  const p = await panel()
  await openReport(p)
  await p.event(t0, "call", "call", { text: "w8abe" })
  await p.event(t0, "kind", "kind", { text: "heard" })
  await p.event(t0, "back", "back")
  const again = await openReport(p)
  assert.equal(again.strings.call, "W8ABE")
  assert.equal(again.strings.kind, "")
})

test("a report that was sent makes the marks fetch AMSAT's reports again", async () => {
  const p = await panel()
  await openReport(p)
  const before = p.fetched.filter((u) => u === statusUrl(24)).length
  await p.event(t0, "kind", "kind", { text: "heard" })
  await p.render(t0 + 60_000)
  assert.equal(p.fetched.filter((u) => u === statusUrl(24)).length, before, "inside its ten minutes")
  await p.event(t0, "send", "send")
  await p.event(t0, "confirm", "confirm")
  await p.render(t0)
  assert.equal(p.fetched.filter((u) => u === statusUrl(24)).length, before + 1)
})

test("a refusal, an error page and a dead connection are each said, and the report is kept to try again", async () => {
  for (const [answer, message] of [
    [() => ({ status: 503, body: "" }), /did not take it \(HTTP 503\)/],
    [() => ({ status: 422, body: JSON.stringify({ error: { code: "invalid_parameter", message: "callsign is not valid", status: 422 } }) }), /AMSAT did not take it: callsign is not valid \(HTTP 422\)/],
    // Anything but a 201 is not a report taken, whatever the page says.
    [() => ({ status: 200, body: "<html><body>Thank you for your report.</body></html>" }), /did not take it \(HTTP 200\): Thank you for your report/],
    [() => {
      throw new Error("network down")
    }, /Could not reach AMSAT\. Nothing was sent\./],
  ] as const) {
    const p = await panel({ answer })
    await openReport(p)
    await p.event(t0, "kind", "kind", { text: "heard" })
    await p.event(t0, "send", "send")
    await p.event(t0, "confirm", "confirm")
    const after = await p.render(t0)
    assert.match(after.strings.message, message)
    assert.equal(after.strings.kind, "heard", "still chosen, so it can be sent again")
  }
})

test("when AMSAT's catalog cannot be read, the page says so and nothing can be sent", async () => {
  const p = await panel({ noForm: true })
  const scene = await openReport(p)
  assert.match(scene.strings.summary, /Could not read AMSAT's list of satellites/)
  assert.equal(control(scene, "send")?.disabled, true)
  await p.event(t0, "kind", "kind", { text: "heard" })
  await p.event(t0, "send", "send")
  await p.event(t0, "confirm", "confirm")
  assert.equal(p.posted.length, 0)
})

test("the other pages have the Report tab too, and nothing is sent just by looking at it", async () => {
  const p = await panel()
  const list = await p.render(t0)
  await p.event(t0, list.controls.find((c) => c.id.startsWith("open:") && c.opacity !== 0)!.id, "open")
  const sky = await p.render(t0)
  assert.deepEqual(sky.controls.filter((c) => c.id.startsWith("tab_")).map((c) => [c.id, c.kind, c.label]), [
    ["tab_sky", "nativeChip", "Sky"],
    ["tab_radio", "nativeChip", "Radio"],
    ["tab_report", "nativeChip", "Report"],
  ])
  assert.deepEqual([sky.values.tab_sky, sky.values.tab_radio, sky.values.tab_report], [1, 0, 0], "the page shown is lit")
  assert.equal(p.fetched.includes(CATALOG_URL), false, "the catalog is only read when the Report page is opened")
  await p.event(t0, "tab", "tab", { text: "report" })
  await p.render(t0)
  await p.event(t0, "tab", "tab", { text: "radio" })
  assert.equal((await p.render(t0)).strings.tab, "radio")
  assert.equal(p.posted.length, 0)
})
