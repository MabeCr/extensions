// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Every page the extension can draw, held to the rules the app holds a scene to (sceneRules.ts). The app refuses a scene whole, with an
// error naming one control, when it breaks one, and a page that only appears in a state a test did not think of is the one that does.

import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCatalog, ELEMENTS_URL, LIST_URL, parseElements, parseList, statusUrl } from "./data.ts"
import { CATALOG, ELEMENTS, LIST, SUMMARY } from "./fixtures.ts"
import { forgetAll } from "./memory.ts"
import { findPasses, satrecFromOmm } from "./orbit.ts"
import { CATALOG_URL } from "./report.ts"
import { loadExtension } from "./sdkGapTesting.ts"
import { violations } from "./sceneRules.ts"
import type { SceneLike } from "./sceneRules.ts"

const ctx = { online: true }
let panes = 0
const t0 = Date.parse("2026-10-07T00:00:00Z")
const ao7 = buildCatalog(parseList(LIST), parseElements(ELEMENTS), {}).find((s) => s.name === "AO-7")!
const best = findPasses(satrecFromOmm(ao7.omm!), { lat: 25.76, lon: -80.19 }, t0, 24, 10).reduce((a, b) => (b.maxElevation > a.maxElevation ? b : a))
const mid = Math.round((best.aos + best.los) / 2)
const before = best.aos - 30 * 60_000
const cfg = { grid: "EL95vs", minElevation: 0, utc: true }
const environment = { version: 1, width: 390, height: 700, colors: { surface: "#101418" }, typography: { mono: { fontFamily: "RobotoMono", fontSize: 13, scaledFontSize: 13 } } }

/// AMSAT's catalog as it can be: as it is, with nothing in it for AO-7 or FO-29, empty, or down.
type Catalog = "normal" | "no-entry" | "empty" | "down"

async function panel(catalog: Catalog = "normal", env: typeof environment | undefined = environment) {
  forgetAll()
  const id = ++panes
  const settings = new Map<string, unknown>()
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      getLocation: () => null,
      kvGet: () => null,
      kvSet: () => undefined,
      getSettings: () => ({ extensions: { "extension_km4be-satellite-info": Object.fromEntries(settings) } }),
      setSettings: (params) => {
        for (const [k, v] of Object.entries(params.values as Record<string, unknown>)) settings.set(k, v)
      },
      fetch: (params) => {
        const url = String(params.url)
        if (url === CATALOG_URL) {
          if (catalog === "down") return { status: 503, body: "" }
          if (catalog === "empty") return { status: 200, body: JSON.stringify({ data: [] }) }
          if (catalog === "no-entry") return { status: 200, body: JSON.stringify({ data: CATALOG.data.filter((s) => /^(ISS|AO-123)/.test(s.name)) }) }
          return { status: 200, body: JSON.stringify(CATALOG) }
        }
        return url === LIST_URL
          ? { status: 200, body: JSON.stringify(LIST) }
          : url === ELEMENTS_URL
            ? { status: 200, body: JSON.stringify(ELEMENTS) }
            : url === statusUrl(24)
              ? { status: 200, body: JSON.stringify(SUMMARY) }
              : { status: 404, body: "" }
      },
    },
  })
  const args = (config: Record<string, unknown>, at: number) => ({
    panelKey: "passes",
    instanceId: `rules-${id}`,
    operation: {},
    qsoCount: 0,
    reason: "",
    config,
    clock: { nowMillis: at, realNowMillis: at },
    ...(env ? { environment: env } : {}),
  })
  return {
    render: async (config: Record<string, unknown>, at: number) => ((await ext.runHook("panel", "render", args(config, at), { ctx })) as { scene: SceneLike }).scene,
    event: async (config: Record<string, unknown>, at: number, controlId: string, action: string, extra: { text?: string; value?: number } = {}) =>
      ext.runHook("panel", "onEvent", { ...args(config, at), event: { controlId, action, phase: "commit", sequence: 1, ...extra } }, { ctx }),
    open: async (config: Record<string, unknown>) => {
      const list = await ext.runHook("panel", "render", args(config, before), { ctx }) as { scene: SceneLike }
      const wanted = list.scene.controls!.filter((c) => /^open:AO-7:/.test(c.id)).find((c) => Math.abs(Number(c.id.split(":")[2]) - best.los) < 120_000)
      assert.ok(wanted, "the best pass is listed")
      await ext.runHook("panel", "onEvent", { ...args(config, before), event: { controlId: wanted!.id, action: "open", phase: "activate", sequence: 1 } }, { ctx })
    },
  }
}

const check = (scene: SceneLike, what: string) => assert.deepEqual(violations(scene), [], what)

test("the checker itself: it names a dropdown with no options, which is what the app refused", () => {
  const broken: SceneLike = {
    values: {},
    strings: { variant: "" },
    layers: [],
    controls: [{ id: "variant", kind: "nativeDropdown", label: "Transponder", value: "variant", options: [] }],
  }
  assert.deepEqual(violations(broken), ["variant: a nativeDropdown has no options"])
  // And the other ways a choice goes wrong.
  const wrong = (patch: object, strings: Record<string, string>) =>
    violations({ ...broken, strings, controls: [{ id: "c", kind: "nativeSegmented", label: "C", value: "c", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }], ...patch }] })
  assert.deepEqual(wrong({}, { c: "a" }), [])
  assert.deepEqual(wrong({}, { c: "" }), [], "empty is a choice")
  assert.deepEqual(wrong({}, { c: "z" }), ['c: its choice "z" is not one of its options'])
  assert.deepEqual(wrong({ options: [{ label: "A", value: "a" }, { label: "B", value: "a" }] }, { c: "a" }), ["c: two options have the same value"])
  assert.deepEqual(wrong({ label: " " }, { c: "a" }), ["c has no label"])
})

test("the list, the favorites with none, and the sky are as the app wants them, on a phone and where the host reports no size", async () => {
  for (const env of [environment, undefined]) {
    const p = await panel("normal", env)
    check(await p.render(cfg, before), "the list")
    check(await p.render({ ...cfg, minElevation: 60 }, before), "a list with nothing in it")
    await p.event(cfg, before, "mode", "mode", { text: "favorites" })
    check(await p.render(cfg, before), "favorites with nobody followed")
    await p.event(cfg, mid, "mode", "mode", { text: "now" })
    check(await p.render(cfg, mid), "the sky with a satellite up")
    check(await p.render(cfg, before), "the sky with none")
  }
  const none = await panel("normal")
  check(await none.render({}, t0), "no location at all")
})

test("a pass's three pages are as the app wants them", async () => {
  const p = await panel()
  await p.open(cfg)
  for (const tab of ["sky", "radio", "report"]) {
    await p.event(cfg, mid, `tab_${tab}`, `tab-${tab}`)
    check(await p.render(cfg, mid), `the ${tab} page`)
  }
  // The report page as it is filled in and sent.
  await p.event(cfg, mid, "kind", "kind", { text: "heard" })
  check(await p.render(cfg, mid), "chosen")
  await p.event(cfg, mid, "send", "send")
  check(await p.render(cfg, mid), "asked to be sure")
  await p.event(cfg, mid, "call", "call", { text: "banana" })
  check(await p.render(cfg, mid), "with a callsign that is not one")
})

test("the report page is as the app wants it whatever AMSAT has to offer, and says what is wrong instead of drawing an empty dropdown", async () => {
  for (const catalog of ["normal", "no-entry", "empty", "down"] as const) {
    const p = await panel(catalog)
    await p.open(cfg)
    await p.event(cfg, mid, "tab_report", "tab-report")
    const scene = await p.render(cfg, mid)
    check(scene, `the report page with AMSAT's catalog ${catalog}`)
    const dropdown = scene.controls!.find((c) => c.id === "variant")!
    assert.ok(dropdown.options!.length >= 1, `${catalog}: something to choose`)
    if (catalog !== "normal") {
      assert.equal(scene.strings!.variant, "", `${catalog}: nothing is chosen`)
      assert.match(scene.strings!.summary, catalog === "no-entry" ? /no entry for this satellite/ : /Could not read AMSAT's list/)
      assert.equal(scene.controls!.find((c) => c.id === "send")!.disabled, true, `${catalog}: nothing can be sent`)
      assert.equal(dropdown.disabled, true, `${catalog}: and the dropdown says it has nothing`)
    }
  }
})
