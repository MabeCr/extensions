// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// HamAlert's stored alert records, as `spots2` answers them, read into spots
// and into the mute each one would take.

import { test } from "node:test"
import assert from "node:assert/strict"

import { modeMatches, muteFor, newestPerStation, parseAlerts, qsoWorks, receivedAtMillis, spotForAlert, triggerComments } from "./alerts.ts"
import type { HamAlertRecord } from "./alerts.ts"

/// A POTA spot as HamAlert's server stores it: its own `normalizeSpot`
/// fields, the DXCC objects it looked up, and the matched triggers' comments.
const potaAlert: HamAlertRecord = {
  _id: '671b9a3fe4b0a1c2d3e4f501',
  source: 'pota',
  time: '14:03',
  fullCallsign: 'KI2D/P',
  callsign: 'KI2D',
  wwffDivision: 'US',
  wwffRef: 'US-1234',
  wwffName: 'Bear Mountain State Park',
  wwffProgram: 'pota',
  frequency: 14.0615,
  mode: 'cw',
  modeDetail: 'cw',
  comment: 'QRP',
  spotter: 'k2hrc',
  band: '20m',
  receivedDate: '2026-10-25T14:03:07+0000',
  triggerComment: ['Friends', 'Parks'],
} as HamAlertRecord

test("the records come from `spots`, and nothing else is read as one", () => {
  assert.deepEqual(parseAlerts('{"spots":[{"callsign":"KI2D"}]}'), [{ callsign: 'KI2D' }])
  assert.deepEqual(parseAlerts('{"spots":[],"hasAnyAppTrigger":false}'), [])
  assert.deepEqual(parseAlerts('{}'), [])
  assert.throws(() => parseAlerts('<html>'))
})

test("PHP's offset, written without a colon, still reads as UTC", () => {
  assert.equal(receivedAtMillis(potaAlert), Date.UTC(2026, 9, 25, 14, 3, 7))
  assert.equal(receivedAtMillis({ receivedDate: '2026-10-25T14:03:07+02:00' }), Date.UTC(2026, 9, 25, 12, 3, 7))
  assert.equal(receivedAtMillis({}), 0)
  assert.equal(receivedAtMillis({ receivedDate: 'yesterday' }), 0)
})

test("trigger comments arrive as a list, or comma-joined on an older record", () => {
  assert.deepEqual(triggerComments(potaAlert), ['Friends', 'Parks'])
  assert.deepEqual(triggerComments({ triggerComment: 'Friends, Parks' }), ['Friends', 'Parks'])
  assert.deepEqual(triggerComments({ triggerComment: [] }), [])
  assert.deepEqual(triggerComments({}), [])
})

test("an alert is a spot on its frequency, labelled by the triggers that fired", () => {
  assert.deepEqual(spotForAlert(potaAlert), {
    their: { call: 'KI2D/P' },
    freq: 14061.5,
    band: '20m',
    mode: 'CW',
    refs: [{ type: 'pota', ref: 'US-1234' }],
    spot: {
      timeInMillis: Date.UTC(2026, 9, 25, 14, 3, 7),
      source: 'hamalert',
      label: 'Friends, Parks — Bear Mountain State Park',
      sourceInfo: {
        alertId: '671b9a3fe4b0a1c2d3e4f501',
        origin: 'pota',
        spotter: 'K2HRC',
        comments: 'QRP',
        triggers: ['Friends', 'Parks'],
      },
    },
  })
})

test("a summit is a SOTA ref, and a WWFF reference stays WWFF", () => {
  const sota = spotForAlert({ fullCallsign: 'HB9DQM', frequency: 7.032, mode: 'cw', source: 'sotawatch', summitRef: 'HB/BE-001', summitName: 'Niesen' })
  assert.deepEqual(sota?.refs, [{ type: 'sota', ref: 'HB/BE-001' }])
  assert.equal(sota?.spot.label, 'Niesen')
  const wwff = spotForAlert({ fullCallsign: 'DL1ABC', frequency: 14.244, mode: 'ssb', source: 'cluster', wwffRef: 'DLFF-0001', wwffProgram: 'wwff' })
  assert.deepEqual(wwff?.refs, [{ type: 'wwff', ref: 'DLFF-0001' }])
})

test("the mode is the one the source named, else the band plan's", () => {
  assert.equal(spotForAlert({ fullCallsign: 'K1ABC', frequency: 14.074, mode: 'psk', modeDetail: 'psk31' })?.mode, 'PSK31')
  assert.equal(spotForAlert({ fullCallsign: 'K1ABC', frequency: 14.074, mode: 'ft8', modeDetail: 'ft8' })?.mode, 'FT8')
  assert.equal(spotForAlert({ fullCallsign: 'K1ABC', frequency: 14.025 })?.mode, 'CW')
})

test("an alert with no frequency to tune to is not a spot", () => {
  assert.equal(spotForAlert({ fullCallsign: 'DB0ABC', band: '70cm', mode: 'dstar' }), undefined)
  assert.equal(spotForAlert({ frequency: 14.074 }), undefined)
})

test("a station spotted again and again is one spot per band, the newest", () => {
  const at = (receivedDate: string, frequency: number) => spotForAlert({ ...potaAlert, receivedDate, frequency })!
  const spots = newestPerStation([
    at('2026-10-25T14:03:07+0000', 14.0615),
    at('2026-10-25T14:09:00+0000', 14.0625),
    at('2026-10-25T14:05:00+0000', 14.0605),
    at('2026-10-25T14:07:00+0000', 7.0315),
  ])
  assert.deepEqual(spots.map((spot) => [spot.band, spot.freq]), [['20m', 14062.5], ['40m', 7031.5]])
})

test("a mute names the call HamAlert matches, with the alert's own band and mode", () => {
  assert.deepEqual(muteFor(potaAlert), { callsign: 'KI2D', band: '20m', mode: 'cw' })
  assert.deepEqual(muteFor({ fullCallsign: 'k1abc' }), { callsign: 'K1ABC', band: null, mode: null })
  assert.equal(muteFor({}), undefined)
})

test("a contact's mode matches the group HamAlert files it under", () => {
  assert.equal(modeMatches('USB', 'ssb'), true)
  assert.equal(modeMatches('LSB', 'ssb'), true)
  assert.equal(modeMatches('PSK31', 'psk'), true)
  assert.equal(modeMatches('JT65', 'jt'), true)
  assert.equal(modeMatches('FT8', 'ft8'), true)
  assert.equal(modeMatches('CW', 'ssb'), false)
  assert.equal(modeMatches('FT4', 'ft8'), false)
  assert.equal(modeMatches('FT4', null), true)
})

test("a contact works the alerted station on its band and mode, from the time given", () => {
  const mute = { callsign: 'KI2D', band: '20m', mode: 'cw' }
  const from = Date.UTC(2026, 9, 25, 13, 48)
  const qso = { startAtMillis: Date.UTC(2026, 9, 25, 14, 10), band: '20m', mode: 'CW' }
  assert.equal(qsoWorks(qso, mute, from), true)
  assert.equal(qsoWorks({ ...qso, band: '40m' }, mute, from), false)
  assert.equal(qsoWorks({ ...qso, mode: 'SSB' }, mute, from), false)
  assert.equal(qsoWorks({ ...qso, startAtMillis: from - 1 }, mute, from), false)
  assert.equal(qsoWorks({ ...qso, band: '40m', mode: 'SSB' }, { callsign: 'KI2D', band: null, mode: null }, from), true)
})
