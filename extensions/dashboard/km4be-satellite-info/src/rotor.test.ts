// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import type { StationEquipment } from "@ham2k/extension-sdk"

import { buildCatalog, parseElements, parseList } from "./data.ts"
import { ELEMENTS, LIST } from "./fixtures.ts"
import { findPasses, lookAt, satrecFromOmm } from "./orbit.ts"
import { azDiff, LEAD_MS, RotatorTracker, rotatorOptions, STEP_DEG } from "./rotor.ts"
import type { RotatorHost } from "./rotor.ts"

const ao7 = buildCatalog(parseList(LIST), parseElements(ELEMENTS), {}).find((s) => s.name === "AO-7")!
const satrec = satrecFromOmm(ao7.omm!)
const miami = { lat: 25.76, lon: -80.19 }
const pass = findPasses(satrec, miami, Date.parse("2026-10-07T00:00:00Z"), 24, 10).reduce((a, b) => (b.maxElevation > a.maxElevation ? b : a))
const tracked = { satellite: ao7, observer: miami, aos: pass.aos, los: pass.los }

function fakeRotators(elevation = true, connected = true) {
  const sent: { id: string; azimuth: number; elevation?: number }[] = []
  const device: StationEquipment = { id: "rot1", kind: "rotator", name: "G-5500", connected, azimuth: 0, ...(elevation ? { elevation: 0 } : {}) }
  const host: RotatorHost = {
    async listEquipment() {
      return [{ id: "sw1", kind: "antennaSwitch", name: "Switch", connected: true }, device]
    },
    async setRotator(args) {
      sent.push(args)
      return { accepted: connected, ...(connected ? {} : { reason: "disconnected" as const }), state: device }
    },
  }
  return { host, sent }
}

test("before rise the rotator turns to where the satellite comes up, on the horizon, once", async () => {
  let now = pass.aos - 5 * 60_000
  const { host, sent } = fakeRotators()
  const rotor = new RotatorTracker(host, () => now)
  rotor.setRotator("rot1")
  rotor.start(tracked)
  await rotor.tick()
  now += 60_000
  await rotor.tick()
  const rise = lookAt(satrec, miami, pass.aos)!
  assert.deepEqual(sent, [{ id: "rot1", azimuth: Math.round(rise.azimuth) % 360, elevation: 0 }])
  assert.match(rotor.status().line, /^Rotator ready for rise: G-5500 to \d+° [NESW]+, El 0°$/)
})

test("during the pass it is aimed a little ahead, and told again only after the satellite has moved a few degrees", async () => {
  let now = pass.aos + 10_000
  const { host, sent } = fakeRotators()
  const rotor = new RotatorTracker(host, () => now)
  rotor.setRotator("rot1")
  rotor.start(tracked)
  for (; now < pass.los; now += 1_000) await rotor.tick()
  assert.ok(sent.length > 5 && sent.length < (pass.los - pass.aos) / 1000 / 3, `${sent.length} commands`)
  for (let i = 1; i < sent.length; i++) {
    const step = Math.max(azDiff(sent[i].azimuth, sent[i - 1].azimuth), Math.abs(sent[i].elevation! - sent[i - 1].elevation!))
    assert.ok(step >= STEP_DEG, `step ${i}: ${step}`)
  }
  const first = lookAt(satrec, miami, pass.aos + 10_000 + LEAD_MS)!
  assert.equal(sent[0].azimuth, Math.round(first.azimuth) % 360)
  // Up past its peak along the way.
  assert.ok(Math.max(...sent.map((s) => s.elevation!)) >= Math.round(pass.maxElevation) - STEP_DEG)
})

test("an azimuth-only rotator is sent no elevation", async () => {
  const { host, sent } = fakeRotators(false)
  const rotor = new RotatorTracker(host, () => pass.aos + 30_000)
  rotor.setRotator("rot1")
  rotor.start(tracked)
  await rotor.tick()
  assert.equal(sent.length, 1)
  assert.equal(sent[0].elevation, undefined)
  assert.doesNotMatch(rotor.status().line, /El/)
})

test("it says when the rotator is not connected or not chosen, and stops after set", async () => {
  let now = pass.aos + 30_000
  const off = fakeRotators(true, false)
  const rotor = new RotatorTracker(off.host, () => now)
  rotor.start(tracked)
  await rotor.tick()
  assert.equal(rotor.status().line, "Rotator: choose one to point.")
  rotor.setRotator("rot1")
  await rotor.tick()
  assert.equal(rotor.status().line, "Rotator: G-5500 is not connected.")
  assert.equal(off.sent.length, 0)
  now = pass.los + 11_000
  await rotor.tick()
  assert.equal(rotor.active, false)
  assert.match(rotor.status().line, /left where AO-7 set/)
})

test("the short way round, and only rotators in the list", () => {
  assert.equal(azDiff(358, 2), 4)
  assert.equal(azDiff(90, 270), 180)
  assert.deepEqual(rotatorOptions([{ id: "sw", kind: "antennaSwitch", name: "Switch", connected: true }, { id: "r", kind: "rotator", name: "G-5500", connected: true }]), [
    { label: "No rotator", value: "" },
    { label: "G-5500", value: "r" },
  ])
})
