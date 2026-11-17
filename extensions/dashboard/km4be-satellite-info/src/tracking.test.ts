// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import type { PanelRadioResult, PanelRadioSet, PanelRadioState } from "@ham2k/extension-sdk"

import { buildCatalog, parseElements, parseList } from "./data.ts"
import type { Satellite } from "./data.ts"
import { ELEMENTS, LIST } from "./fixtures.ts"
import { downlinkDoppler, findPasses, rangeRate, satrecFromOmm, uplinkDoppler } from "./orbit.ts"
import { DopplerTracker, inverting, RESEND_HZ, startMode, uplinkFor, uplinkOptions } from "./tracking.ts"
import type { RadioHost } from "./tracking.ts"

const catalog = buildCatalog(parseList(LIST), parseElements(ELEMENTS), {})
const ao7 = catalog.find((s) => s.name === "AO-7")!
// AO-7's orbit with a U/v inverting transponder, which makes the shift large enough to see.
const bird: Satellite = {
  ...ao7,
  modulation: "linear",
  downlinks: [{ mode: "linear", lowerMHz: 145.9, upperMHz: 146.0 }],
  uplinks: [{ mode: "linear", lowerMHz: 435.1, upperMHz: 435.2 }],
  info: { ...ao7.info, inversion: "inverting" },
}
const satrec = satrecFromOmm(ao7.omm!)
const miami = { lat: 25.76, lon: -80.19 }
const pass = findPasses(satrec, miami, Date.parse("2026-10-07T00:00:00Z"), 24, 10).reduce((a, b) => (b.maxElevation > a.maxElevation ? b : a))
const tracked = { satellite: bird, observer: miami, aos: pass.aos, los: pass.los }

const rig = (id: string, extra: Partial<PanelRadioState> = {}): PanelRadioState =>
  ({ id, name: id === "main" ? "IC-9700" : "IC-9700", status: "connected", stale: false, problem: null, frequencyHz: 145_000_000, mode: "FM", powerWatts: 10, transmitting: false, meters: {}, canTune: true, modes: ["USB", "LSB", "CW", "FM"], ...extra }) as PanelRadioState

/// A logging radio, `main`, and its sub receiver; every tune lands at once.
function fakeRadios(radios: Record<string, PanelRadioState> = { main: rig("main"), sub: rig("sub", { channel: { key: "sub", label: "Sub" } }) }) {
  const sent: PanelRadioSet[] = []
  const host: RadioHost = {
    async readRadio(id?: string) {
      return radios[id ?? "main"] ?? null
    },
    async setRadio(args: PanelRadioSet): Promise<PanelRadioResult> {
      sent.push(args)
      const r = radios[args.selection ?? "main"]
      if (!r || r.status !== "connected") return { accepted: false, reason: "disconnected", state: null }
      if (args.frequencyHz !== undefined) r.frequencyHz = args.frequencyHz
      if (args.mode) r.mode = args.mode
      return { accepted: true, state: r }
    },
  }
  return { host, sent, radios }
}

const at = (t: number) => {
  const rate = rangeRate(satrec, miami, t)!
  return { down: (mhz: number) => Math.round(downlinkDoppler(mhz, rate) * 1e6), up: (mhz: number) => Math.round(uplinkDoppler(mhz, rate) * 1e6) }
}

test("before rise, the radio waits where the downlink will be heard at rise, in USB for a linear transponder", async () => {
  let now = pass.aos - 120_000
  const { host, sent, radios } = fakeRadios()
  const tracker = new DopplerTracker(host, () => now)
  tracker.start(tracked)
  await tracker.tick()
  assert.equal(radios.main.frequencyHz, at(pass.aos).down(145.95))
  assert.equal(radios.main.mode, "USB")
  assert.match(tracker.status().line, /^Doppler ready for rise: ↓ 145\.95\d{3}$/)
  // Nothing changes before rise, so nothing more is sent.
  now += 30_000
  await tracker.tick()
  assert.equal(sent.length, 1)
})

test("during the pass the downlink follows the shift, and the mode is set only once", async () => {
  let now = pass.aos + 60_000
  const { host, sent, radios } = fakeRadios()
  const tracker = new DopplerTracker(host, () => now)
  tracker.start(tracked)
  for (const t of [now, now + 20_000, now + 40_000, pass.maxElevationAt, pass.los - 30_000]) {
    now = t
    await tracker.tick()
    // Within what is let drift before the radio is told again.
    assert.ok(Math.abs(radios.main.frequencyHz! - at(t).down(145.95)) < RESEND_HZ, new Date(t).toISOString())
  }
  assert.equal(sent.filter((s) => s.mode).length, 1)
  assert.ok(sent.every((s) => s.id === "main" && s.selection === undefined), "the downlink follows whichever radio is the logging one")
  assert.match(tracker.status().line, /^Doppler tracking: ↓ /)
})

test("turning the dial moves the frequency followed at the satellite, as tuning across a transponder does", async () => {
  let now = pass.aos + 60_000
  const { host, radios } = fakeRadios()
  const tracker = new DopplerTracker(host, () => now)
  tracker.start(tracked)
  await tracker.tick()
  // The operator tunes 3 kHz up.
  radios.main.frequencyHz! += 3_000
  const atSatellite = radios.main.frequencyHz! / 1e6 / downlinkDoppler(1, rangeRate(satrec, miami, now + 1000)!)
  now += 1000
  await tracker.tick()
  now += 30_000
  await tracker.tick()
  assert.ok(Math.abs(radios.main.frequencyHz! - at(now).down(atSatellite)) < RESEND_HZ, `${radios.main.frequencyHz} vs ${at(now).down(atSatellite)}`)
  assert.ok(Math.abs(atSatellite - 145.953) < 0.0005, "about 3 kHz above the middle, at the satellite")
})

test("a radio already close enough is not told again", async () => {
  const now = pass.aos + 60_000
  const { host, sent, radios } = fakeRadios()
  const tracker = new DopplerTracker(host, () => now)
  tracker.start(tracked)
  await tracker.tick()
  radios.main.frequencyHz! += RESEND_HZ - 5
  await tracker.tick()
  assert.equal(sent.length, 1)
})

test("with an uplink receiver named, the uplink goes there, through the inverting transponder, corrected the other way", async () => {
  let now = pass.aos + 60_000
  const { host, sent, radios } = fakeRadios()
  const tracker = new DopplerTracker(host, () => now)
  tracker.start(tracked, "sub")
  await tracker.tick()
  // The downlink's middle is 145.95, so the uplink's middle too: 435.15.
  assert.equal(radios.sub.frequencyHz, at(now).up(435.15))
  assert.ok(sent.some((s) => s.id === "sub" && s.selection === "sub"))
  assert.match(tracker.status().line, /↑ 435\.1\d{4}/)
  // Tuning the downlink 10 kHz up takes the uplink 10 kHz down.
  radios.main.frequencyHz! += 10_000
  now += 1000
  await tracker.tick()
  const atSatellite = radios.main.frequencyHz! / 1e6 / downlinkDoppler(1, rangeRate(satrec, miami, now)!)
  assert.ok(Math.abs(radios.sub.frequencyHz! - at(now).up(435.2 - (atSatellite - 145.9))) < RESEND_HZ)
})

test("tracking stops on its own after the satellite sets, and says so", async () => {
  let now = pass.los - 1000
  const { host } = fakeRadios()
  const tracker = new DopplerTracker(host, () => now)
  tracker.start(tracked)
  await tracker.tick()
  assert.ok(tracker.isTracking("AO-7", pass.los))
  now = pass.los + 11_000
  await tracker.tick()
  assert.equal(tracker.active, false)
  assert.match(tracker.status().line, /stopped: AO-7 has set/)
})

test("with no radio connected, nothing is sent and the line says why", async () => {
  const { host, sent } = fakeRadios({ main: rig("main", { status: "disconnected" }) })
  const tracker = new DopplerTracker(host, () => pass.aos + 60_000)
  tracker.start(tracked)
  await tracker.tick()
  assert.equal(sent.length, 0)
  assert.equal(tracker.status().line, "Doppler tracking: no radio connected.")
})

test("a satellite with no downlink, or no orbit, cannot be tracked", async () => {
  const { host } = fakeRadios()
  const tracker = new DopplerTracker(host, () => pass.aos)
  tracker.start({ ...tracked, satellite: { ...bird, downlinks: [] } })
  await tracker.tick()
  assert.equal(tracker.active, false)
  assert.match(tracker.status().line, /no downlink/)
})

test("transponders: inverting only when the list says so outright, and the uplink keeps its place in the band", () => {
  assert.equal(inverting(bird), true)
  assert.equal(inverting({ ...bird, info: { inversion: "Mode A non-inverting, Mode B inverting" } }), false)
  assert.equal(inverting({ ...bird, modulation: "fm" }), false)
  const [down, up] = [bird.downlinks[0], bird.uplinks[0]]
  assert.ok(Math.abs(uplinkFor(bird, down, up, 145.91) - 435.19) < 1e-9)
  assert.ok(Math.abs(uplinkFor({ ...bird, info: {} }, down, up, 145.91) - 435.11) < 1e-9)
  assert.ok(Math.abs(uplinkFor({ ...bird, modulation: "fm" }, down, up, 145.91) - 435.15) < 1e-9)
  assert.equal(startMode({ ...bird, modulation: "fm" }, ["USB", "FM"]), "FM")
  assert.equal(startMode(bird, ["FM"]), undefined)
})

test("the uplink can go to any radio but the logging one, by its name and receiver", () => {
  const options = uplinkOptions([rig("main"), rig("sub", { name: "IC-9700", channel: { key: "sub", label: "Sub" } }), rig("ft818", { name: "FT-818" })], "main")
  assert.deepEqual(options, [
    { label: "No uplink radio", value: "" },
    { label: "IC-9700 Sub", value: "sub" },
    { label: "FT-818", value: "ft818" },
  ])
})
