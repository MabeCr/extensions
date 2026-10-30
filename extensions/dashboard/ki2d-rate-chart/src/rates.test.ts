// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HOUR, MINUTE, contactTimes, extremes, lastRate, rateAt } from './rates.ts'

const t0 = Date.UTC(2026, 9, 13, 12)
const every = (from: number, gap: number, count: number) => Array.from({ length: count }, (_, i) => from + i * gap)

test('contacts are the log minus event markers, credited to the named operator or else the station', () => {
  const { times, operators } = contactTimes([
    { startAtMillis: t0 + 2 * MINUTE, our: { call: 'W1AW', operatorCall: 'ki2d' } },
    { startAtMillis: t0, our: { call: 'W1AW' } },
    { startAtMillis: t0 + MINUTE, band: 'event', our: { call: 'W1AW' } },
    { startAtMillis: t0 + 3 * MINUTE, our: { call: 'W1AW', operatorCall: '' } },
    { our: { call: 'W1AW' } },
  ])
  assert.deepEqual(times, [t0, t0 + 2 * MINUTE, t0 + 3 * MINUTE])
  assert.deepEqual(Object.fromEntries(operators), { W1AW: [t0, t0 + 3 * MINUTE], KI2D: [t0 + 2 * MINUTE] })
})

test('a trailing rate counts the window ending at the sample, scaled to an hour', () => {
  const times = every(t0, MINUTE, 10)
  assert.equal(rateAt(times, t0 + 9 * MINUTE, 10 * MINUTE), 60)
  // The window's start is open: a contact exactly one window back has left it.
  assert.equal(rateAt(times, t0 + 10 * MINUTE, 10 * MINUTE), 54)
})

test('the last-10 rate is the stats formula while the run goes on, then fades to nothing over ten gaps', () => {
  const times = every(t0, MINUTE, 11)
  const last = times[times.length - 1]
  assert.equal(lastRate(times.slice(0, 10), last, 10), undefined, 'needs more than ten contacts')
  const rate = 10 * HOUR / (9 * MINUTE)
  assert.equal(lastRate(times, last, 10), rate)
  assert.equal(lastRate(times, last + MINUTE, 10), rate, 'holds for one average gap')
  const fading = lastRate(times, last + 3 * MINUTE, 10)!
  assert.ok(fading > 0 && fading < rate)
  assert.equal(lastRate(times, last + 10 * MINUTE, 10), 0)
})

test('the low only counts samples whose whole window sits inside a run of operating', () => {
  // Two hours at 30/h, a two-hour break, then two hours at 60/h.
  const times = [...every(t0, 2 * MINUTE, 60), ...every(t0 + 4 * HOUR, MINUTE, 120)]
  const samples = every(t0, 10 * MINUTE, 37)
  const rates = samples.map(time => rateAt(times, time, HOUR))
  const { peak, low } = extremes(samples, rates, times, HOUR)
  assert.equal(peak!.value, 60)
  // Without the run rule the low would be the zero in the break, or the ramp from the first contact.
  assert.equal(low!.value, 30)
})

test('a flat log has a peak and no separate low', () => {
  const times = every(t0, MINUTE, 120)
  const samples = every(t0 + HOUR, 10 * MINUTE, 6)
  const { peak, low } = extremes(samples, samples.map(time => rateAt(times, time, HOUR)), times, HOUR)
  assert.equal(peak!.value, 60)
  assert.equal(low, undefined)
})
