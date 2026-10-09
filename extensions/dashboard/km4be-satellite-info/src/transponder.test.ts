// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCatalog, ELEMENTS_URL, LIST_URL, parseElements, parseList, statusUrl } from "./data.ts"
import type { Satellite } from "./data.ts"
import { ELEMENTS, LIST, SUMMARY } from "./fixtures.ts"
import { forgetAll } from "./memory.ts"
import { compass, compass8, findPasses, satrecFromOmm } from "./orbit.ts"
import { radioLines, transponderLine, transponderShort, TRANSPONDERS } from "./radio.ts"
import { loadExtension } from "./sdkGapTesting.ts"

const miami = { lat: 25.76, lon: -80.19 }
const t0 = Date.parse("2026-10-07T00:00:00Z")
const catalog = buildCatalog(parseList(LIST), parseElements(ELEMENTS))
const ao7 = catalog.find((s) => s.name === "AO-7")!
const best = findPasses(satrecFromOmm(ao7.omm!), miami, t0, 24, 10)[0]
const bare = (modulation: string, inversion?: string): Pick<Satellite, "modulation" | "info"> => ({ modulation, info: inversion ? { inversion } : {} })

// --- what each kind is called -----------------------------------------------------------

test("the three kinds the list names each have a short name for the column and a longer for the page", () => {
  assert.deepEqual(Object.keys(TRANSPONDERS).sort(), ["digital", "fm", "linear"])
  assert.deepEqual([transponderShort("fm"), transponderShort("linear"), transponderShort("digital")], ["FM", "SSB", "Dig"])
  assert.ok(Object.values(TRANSPONDERS).every((t) => t.short.length <= 3), "short enough for a phone's line")
  assert.equal(transponderLine(bare("fm")), "FM repeater")
  assert.equal(transponderLine(bare("linear")), "Linear (SSB/CW)")
  assert.equal(transponderLine(bare("digital")), "Digital")
})

test("a kind the list has not said is a question mark in the column and nothing on the page", () => {
  assert.equal(transponderShort(""), "?")
  assert.equal(transponderShort("something new"), "?")
  assert.equal(transponderLine(bare("")), null)
  assert.equal(transponderLine(bare("something new")), null)
})

test("inversion is said of a linear transponder that has it recorded, and of no other kind", () => {
  assert.equal(transponderLine(bare("linear", "inverting")), "Linear (SSB/CW), inverting")
  assert.equal(transponderLine(bare("linear", "non-inverting")), "Linear (SSB/CW), non-inverting")
  assert.equal(transponderLine(bare("fm", "inverting")), "FM repeater", "an FM repeater has no sidebands to turn over")
  assert.equal(transponderLine(bare("linear")), "Linear (SSB/CW)", "and not guessed where it is not recorded")
  // The real data, from AMSAT's linear page: AO-7's two modes differ.
  assert.equal(transponderLine(ao7), "Linear (SSB/CW), Mode A non-inverting, Mode B inverting")
})

test("the Radio page opens with the kind of transponder, before the frequencies it is about", () => {
  const lines = radioLines(ao7, miami, best, t0)
  assert.equal(lines[0], "Linear (SSB/CW), Mode A non-inverting, Mode B inverting")
  assert.match(lines[1], /^Doppler-corrected:/)
  // A satellite the list gives no kind starts at its frequencies.
  const unknown = radioLines({ ...ao7, modulation: "" }, miami, best, t0)
  assert.match(unknown[0], /^Doppler-corrected:/)
})

// --- the eight points a phone's line is given -------------------------------------------------

test("eight points of the compass, for a line that has to fit", () => {
  assert.deepEqual([0, 45, 90, 135, 180, 225, 270, 315, 360, -45].map(compass8), ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "N", "NW"])
  assert.equal(compass8(22), "N")
  assert.equal(compass8(23), "NE")
  assert.equal(compass(22.5), "NNE", "the full sixteen are still there")
})

// --- through the panel -------------------------------------------------------------------------

const ctx = { online: true }
let panes = 0

async function panel(environment?: { width: number; height: number }) {
  forgetAll()
  const id = ++panes
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      getLocation: () => null,
      kvGet: () => null,
      kvSet: () => undefined,
      fetch: (params) => {
        const url = String(params.url)
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
    instanceId: `type-${id}`,
    operation: {},
    qsoCount: 0,
    reason: "",
    config,
    clock: { nowMillis: at, realNowMillis: at },
    ...(environment ? { environment } : {}),
  })
  return {
    render: async (config: Record<string, unknown>, at = t0) =>
      ((await ext.runHook("panel", "render", args(config, at), { ctx })) as { scene: { strings: Record<string, string>; controls: { id: string; opacity?: number }[] } }).scene,
    event: async (config: Record<string, unknown>, at: number, controlId: string, action: string, extra: { text?: string } = {}) =>
      ext.runHook("panel", "onEvent", { ...args(config, at), event: { controlId, action, phase: "activate", sequence: 1, ...extra } }, { ctx }),
  }
}

const cfg = { grid: "EL95vs", utc: true, minElevation: 0 }
const rowsOf = (strings: Record<string, string>) => [0, 1, 2, 3, 4].map((i) => strings[`row${i}`]).filter(Boolean)

test("the list has a Type column next to the name, and every row says what its satellite is", async () => {
  const p = await panel({ width: 1000, height: 700 })
  const { strings } = await p.render(cfg)
  assert.match(strings.columns, /^Sat +Type +Start +Max +Path +Len +Rpt$/)
  const rows = rowsOf(strings)
  assert.ok(rows.length > 0)
  // AO-7 and FO-29 are both linear in the list.
  for (const row of rows) assert.match(row, /^(AO-7|FO-29) +SSB +/, row)
  // The column lines up with its title.
  for (const row of rows) assert.equal(row.indexOf("SSB"), strings.columns.indexOf("Type"))
})

test("a phone's list has the column too, and the shorter compass, and still fits its line", async () => {
  const p = await panel({ width: 390, height: 700 })
  const { strings } = await p.render(cfg)
  const rows = rowsOf(strings)
  const nameWidth = Math.max("Sat".length, ...rows.map((r) => r.split(/ +/)[0].length))
  assert.equal(strings.columns.indexOf("Type") - nameWidth, 1, "one space between columns")
  for (const row of rows) {
    assert.match(row, /SSB/)
    const path = row.match(/([NESW]{1,3})→([NESW]{1,3})/)!
    assert.ok(path[1].length <= 2 && path[2].length <= 2, `${path[0]}: eight points only`)
    assert.ok(row.length <= 36, `${row.length}: ${row}`)
  }
  // A desktop pane keeps sixteen points: at least one path somewhere in a day has three letters.
  const wide = await panel({ width: 1000, height: 700 })
  const all: string[] = []
  for (let page = 0; page < 6; page++) {
    all.push(...rowsOf((await wide.render({ ...cfg, minElevation: 0 })).strings))
    await wide.event(cfg, t0, "next", "next")
  }
  assert.ok(all.some((r) => /[NESW]{3}→|→[NESW]{3}/.test(r)), "the desktop list still names sixteen points")
})

test("the pass's Radio page says what the transponder is, at the top", async () => {
  const p = await panel({ width: 1000, height: 700 })
  const list = await p.render(cfg)
  const open = list.controls.find((c) => c.id.startsWith("open:") && c.opacity !== 0)!
  await p.event(cfg, t0, open.id, "open")
  await p.event(cfg, t0, "tab", "tab", { text: "radio" })
  const { strings } = await p.render(cfg)
  // AO-7's link rows are the first listed on this day; its line carries what AMSAT says of inversion.
  assert.match(strings.radio0, /^Linear \(SSB\/CW\)/)
  assert.match(strings.radio1, /^Doppler-corrected/)
})
