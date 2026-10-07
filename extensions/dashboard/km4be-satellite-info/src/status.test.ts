// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { ELEMENTS_URL, LIST_URL, statusUrl } from "./data.ts"
import { ELEMENTS, LIST, SUMMARY } from "./fixtures.ts"
import { forgetAll } from "./memory.ts"
import { loadExtension } from "./sdkGapTesting.ts"
import { GLYPH, LEGEND, parseSummary, statusFor, statusHours, statusLines } from "./status.ts"

const rows = parseSummary(SUMMARY)
const sat = (name: string, modulation: string, amsat?: string[]) => ({ name, modulation, info: amsat ? { amsat } : {} })
const at = (iso: string) => Date.parse(iso)

test("the summary's rows are split into satellite and variant, and junk is ignored", () => {
  assert.equal(rows.length, 8)
  assert.deepEqual(rows[0], { satellite: "AO-7", variant: "U/v", kind: "heard", count: 2, at: at("2026-10-06T23:30:00Z") })
  assert.equal(rows.find((r) => r.satellite === "ISS" && r.variant === "UHF Digi")?.kind, "heard", "Crew Active counts as heard")
  const odd = parseSummary({
    data: [
      { satellite_display_name: "RS-44", report: "Heard", report_count: 1, latest_reported_time: "2026-10-06T23:30:00Z" },
      { satellite_display_name: "Bare [", report: "Heard", report_count: 1, latest_reported_time: "2026-10-06T23:30:00Z" },
      { satellite_display_name: "X [FM]", report: "Nonsense", report_count: 1, latest_reported_time: "2026-10-06T23:30:00Z" },
      { satellite_display_name: "X [FM]", report: "Heard", report_count: 0, latest_reported_time: "2026-10-06T23:30:00Z" },
      { satellite_display_name: "X [FM]", report: "Heard", report_count: 1, latest_reported_time: "yesterday" },
      null,
    ],
  })
  assert.deepEqual(odd.map((r) => [r.satellite, r.variant]), [["RS-44", ""], ["Bare [", ""]])
  assert.deepEqual(parseSummary(null), [])
  assert.deepEqual(parseSummary({ data: "no" }), [])
})

test("most reports decide, so one bad pass does not undo thirty good ones, and the latest report is kept beside it", () => {
  // AO-7, over two variants of one satellite: heard twice (latest, on U/v) and not heard once.
  assert.deepEqual(statusFor(rows, sat("AO-7", "linear")), {
    kind: "heard",
    heard: 2,
    telemetry: 0,
    notHeard: 1,
    latestKind: "heard",
    latestAt: at("2026-10-06T23:30:00Z"),
  })
  // FO-29: one Heard, then two Telemetry Only: mostly telemetry.
  const fo29 = statusFor(rows, sat("FO-29", "linear"))!
  assert.equal(fo29.kind, "telemetry")
  assert.equal(fo29.latestKind, "telemetry")
  assert.equal(statusFor(rows, sat("Nobody", "fm")), null)

  // RS-44 on 2026-10-07, as AMSAT had it: 39 heard, and one not heard, which came last.
  const rs44 = statusFor(
    parseSummary({
      data: [
        { satellite_display_name: "RS-44 [V/u]", report: "Heard", report_count: 39, latest_reported_time: "2026-10-07T02:30:00Z" },
        { satellite_display_name: "RS-44 [V/u]", report: "Telemetry Only", report_count: 1, latest_reported_time: "2026-10-06T15:30:00Z" },
        { satellite_display_name: "RS-44 [V/u]", report: "Not Heard", report_count: 1, latest_reported_time: "2026-10-07T03:30:00Z" },
      ],
    }),
    sat("RS-44", "linear"),
  )!
  assert.equal(rs44.kind, "heard")
  assert.equal(rs44.latestKind, "notHeard")

  // As many of one kind as another: the more recent one, then the more hopeful.
  const report = (kind: string, count: number, time: string) => ({ satellite_display_name: "T [FM]", report: kind, report_count: count, latest_reported_time: time })
  const recent = parseSummary({ data: [report("Heard", 2, "2026-10-06T10:30:00Z"), report("Not Heard", 2, "2026-10-06T20:30:00Z")] })
  assert.equal(statusFor(recent, sat("T", "fm"))!.kind, "notHeard")
  const same = parseSummary({ data: [report("Not Heard", 2, "2026-10-06T20:30:00Z"), report("Heard", 2, "2026-10-06T20:30:00Z")] })
  assert.equal(statusFor(same, sat("T", "fm"))!.kind, "heard")
})

test("only the variant that is the satellite's own kind of signal counts, and an alias finds the ISS", () => {
  // The ISS FM repeater was last reported not heard; its SSTV being heard 52 times says nothing about it.
  const iss = statusFor(rows, sat("ARISS", "fm", ["ISS"]))!
  assert.equal(iss.kind, "heard")
  assert.equal(iss.latestKind, "notHeard")
  assert.equal(iss.heard, 45, "only the FM variant's reports")
  assert.equal(iss.notHeard, 1)
  assert.equal(statusFor(rows, sat("ARISS", "fm")), null, "the list's own name is not AMSAT's")
  // A digital satellite looks at the digital variants.
  assert.equal(statusFor(rows, sat("ISS", "digital"))!.kind, "heard")
  assert.equal(statusFor(rows, sat("ISS", "digital"))!.latestAt, at("2026-10-07T04:00:00Z"))
  // With none of its own kind of variant, what there is is used rather than nothing.
  assert.equal(statusFor(parseSummary({ data: [{ satellite_display_name: "Z [SSTV]", report: "Heard", report_count: 4, latest_reported_time: "2026-10-06T23:30:00Z" }] }), sat("Z", "fm"))!.heard, 4)
})

test("the detail's two lines say what was reported mostly and what last, in the chosen zone", () => {
  const status = statusFor(rows, sat("ARISS", "fm", ["ISS"]))
  const now = at("2026-10-07T05:00:00Z")
  assert.deepEqual(statusLines(status, 24, now, true), [
    "AMSAT, last 24 h: heard (45 heard, 0 telemetry, 1 not heard)",
    "Latest report: not heard, 10-06 23:30Z",
  ])
  assert.deepEqual(statusLines(null, 48, now, true), ["AMSAT, last 48 h: no reports.", ""])
})

test("the report window is 1 to 168 hours, 24 otherwise", () => {
  assert.equal(statusHours(undefined), 24)
  assert.equal(statusHours({ statusHours: 6 }), 6)
  assert.equal(statusHours({ statusHours: 6.9 }), 6)
  assert.equal(statusHours({ statusHours: 1000 }), 168)
  for (const bad of [0, -3, "12", null, Number.NaN]) assert.equal(statusHours({ statusHours: bad }), 24)
})

// --- through the panel -------------------------------------------------------

const ctx = { online: true }
let panes = 0
const t0 = Date.parse("2026-10-07T00:00:00Z")
const cfg = { grid: "EL95vs" }

async function panel(summary: () => { status: number; body: string }) {
  forgetAll()
  const id = ++panes
  const fetched: string[] = []
  const storage = new Map<string, unknown>()
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      getLocation: () => null,
      kvGet: (params) => storage.get(String(params.key)) ?? null,
      kvSet: (params) => void storage.set(String(params.key), params.value),
      fetch: (params) => {
        const url = String(params.url)
        fetched.push(url)
        if (url === LIST_URL) return { status: 200, body: JSON.stringify(LIST) }
        if (url === ELEMENTS_URL) return { status: 200, body: JSON.stringify(ELEMENTS) }
        if (url === statusUrl(24)) return summary()
        return { status: 404, body: "" }
      },
    },
  })
  return {
    fetched,
    render: async (config: Record<string, unknown>, now: number) =>
      ((await ext.runHook(
        "panel",
        "render",
        { panelKey: "passes", instanceId: `status-${id}`, operation: {}, qsoCount: 0, reason: "", config, clock: { nowMillis: now, realNowMillis: now } },
        { ctx },
      )) as { scene: { strings: Record<string, string> } }).scene,
  }
}

const rowsOf = (strings: Record<string, string>) => [0, 1, 2, 3, 4].map((i) => strings[`row${i}`]).filter(Boolean)

test("each row ends with what AMSAT's reports say, and the legend under the list explains the marks", async () => {
  const p = await panel(() => ({ status: 200, body: JSON.stringify(SUMMARY) }))
  const scene = await p.render({ ...cfg, minElevation: 0 }, t0)
  const lines = rowsOf(scene.strings)
  assert.ok(lines.length > 0)
  for (const line of lines) {
    const name = line.split(/ +/)[0]
    // AO-7 was heard twice and not heard once; FO-29 reported telemetry only twice and heard once.
    assert.equal(line.at(-1), name === "AO-7" ? GLYPH.heard : GLYPH.telemetry, `${name}: ${line}`)
    assert.match(line, / {2}\S$/, "the mark stands apart from the length")
  }
  assert.equal(scene.strings.legend, LEGEND)
  assert.ok(!scene.strings.hint.includes("heard"), "the hint no longer carries it")
})

test("with AMSAT unreachable, rows have no mark, and it is not asked again every minute", async () => {
  let down = true
  const p = await panel(() => (down ? { status: 503, body: "" } : { status: 200, body: JSON.stringify(SUMMARY) }))
  const scene = await p.render(cfg, t0)
  assert.ok(rowsOf(scene.strings).every((line) => /\d+m$/.test(line)), "ends at the length")
  const statusFetches = () => p.fetched.filter((u) => u === statusUrl(24)).length
  assert.equal(statusFetches(), 1)

  await p.render(cfg, t0 + 60_000)
  assert.equal(statusFetches(), 1, "backing off")
  down = false
  const back = await p.render(cfg, t0 + 3 * 60_000)
  assert.equal(statusFetches(), 2, "tried again after the pause")
  assert.ok(rowsOf(back.strings).every((line) => line.at(-1) === GLYPH.heard || line.at(-1) === GLYPH.telemetry))
})
