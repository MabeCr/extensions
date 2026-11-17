// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { AlertLine, alertSettingsFrom, alertsFor, DEFAULT_LEAD_MIN, MAX_ALERTS } from "./alerts.ts"
import type { AlertSettings, FyiHost } from "./alerts.ts"
import { buildCatalog, parseElements, parseList } from "./data.ts"
import { ELEMENTS, LIST } from "./fixtures.ts"
import { findPasses, satrecFromOmm } from "./orbit.ts"
import type { SatellitePass } from "./passes.ts"

const catalog = buildCatalog(parseList(LIST), parseElements(ELEMENTS), {})
const ao7 = catalog.find((s) => s.name === "AO-7")!
const miami = { lat: 25.76, lon: -80.19 }
const best = findPasses(satrecFromOmm(ao7.omm!), miami, Date.parse("2026-10-07T00:00:00Z"), 24, 10).reduce((a, b) => (b.maxElevation > a.maxElevation ? b : a))
const pass: SatellitePass = { ...best, satellite: ao7 }
const on: AlertSettings = { on: true, labels: false, favoritesOnly: false, leadMin: 3, minEl: 10, grid: "" }

const fake = (name: string, aos: number, los: number): SatellitePass => ({ ...pass, aos, los, satellite: { ...ao7, name } })

test("the settings come from the panel's form, off unless switched on", () => {
  assert.deepEqual(alertSettingsFrom(undefined, 10), { on: false, labels: false, favoritesOnly: false, leadMin: DEFAULT_LEAD_MIN, minEl: 10, grid: "" })
  assert.deepEqual(alertSettingsFrom({ alerts: true, bandLabels: true, alertsFavorites: true, alertLead: 99, grid: "EL95" }, 5), { on: true, labels: true, favoritesOnly: true, leadMin: 30, minEl: 5, grid: "EL95" })
})

test("nothing is alerted when alerts are off", () => {
  assert.deepEqual(alertsFor([pass], [], { ...on, on: false }, miami, pass.aos - 60_000), [])
})

test("a pass about to rise says when, where, and how high", () => {
  const [a] = alertsFor([pass], [], on, miami, pass.aos - 2 * 60_000)
  assert.equal(a.key, "pass-AO-7")
  assert.equal(a.category, "info")
  assert.match(a.text, /^\*\*AO-7\*\* rises in 2 min in the [NESW]{1,3}, up to \d+°$/)
  assert.equal(a.expiresInSeconds, Math.ceil((pass.los - (pass.aos - 2 * 60_000)) / 1000))
})

test("a pass further off than the lead time is not alerted yet", () => {
  assert.deepEqual(alertsFor([pass], [], on, miami, pass.aos - 4 * 60_000), [])
  assert.equal(alertsFor([pass], [], { ...on, leadMin: 5 }, miami, pass.aos - 4 * 60_000).length, 1)
})

test("a pass that is up says where the satellite is and when it sets", () => {
  const mid = Math.round((pass.aos + pass.los) / 2)
  const [a] = alertsFor([pass], [], on, miami, mid)
  assert.equal(a.category, "operational")
  assert.match(a.text, /^\*\*AO-7\*\* is up, \d+° [NESW]{1,3}, sets in \d+ min$/)
})

test("a pass that has set is gone", () => {
  assert.deepEqual(alertsFor([pass], [], on, miami, pass.los + 1000), [])
})

test("favorites only leaves out the others", () => {
  const now = pass.aos - 60_000
  assert.equal(alertsFor([pass], ["RS-44"], { ...on, favoritesOnly: true }, miami, now).length, 0)
  assert.equal(alertsFor([pass], ["AO-7"], { ...on, favoritesOnly: true }, miami, now).length, 1)
})

test("a few at most, soonest first", () => {
  const now = pass.aos - 60_000
  const many = ["A", "B", "C", "D", "E"].map((n, i) => fake(n, now + i * 10_000, now + 600_000))
  const alerts = alertsFor(many, [], on, miami, now)
  assert.equal(alerts.length, MAX_ALERTS)
  assert.deepEqual(alerts.map((a) => a.key), ["pass-A", "pass-B", "pass-C"])
})

function fakeFyi() {
  const calls: string[] = []
  const fyi: FyiHost = {
    async post(p) {
      calls.push(`post ${p.key} ${p.text}`)
    },
    async clear(key) {
      calls.push(`clear ${key}`)
    },
  }
  return { fyi, calls }
}

test("the line is posted only when the words change, and cleared when the pass is over", async () => {
  const { fyi, calls } = fakeFyi()
  const line = new AlertLine(fyi)
  const a = { key: "pass-AO-7", text: "one", category: "info" as const, expiresInSeconds: 60 }
  await line.show([a])
  await line.show([a])
  await line.show([{ ...a, text: "two" }])
  await line.show([])
  await line.show([])
  assert.deepEqual(calls, ["post pass-AO-7 one", "post pass-AO-7 two", "clear pass-AO-7"])
})

test("clearing takes down everything on the line", async () => {
  const { fyi, calls } = fakeFyi()
  const line = new AlertLine(fyi)
  await line.show([
    { key: "pass-A", text: "a", category: "info", expiresInSeconds: 60 },
    { key: "pass-B", text: "b", category: "info", expiresInSeconds: 60 },
  ])
  await line.clearAll()
  assert.deepEqual(calls.slice(2), ["clear pass-A", "clear pass-B"])
})
