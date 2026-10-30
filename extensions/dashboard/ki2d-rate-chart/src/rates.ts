// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import type { JSONValue } from '@ham2k/extension-sdk'

export const MINUTE = 60000, HOUR = 60 * MINUTE

export type Contacts = { times: number[]; operators: Map<string, number[]> }

/**
 * The contacts' start times, sorted, for the whole log and for each operator — the one a
 * contact names, else its station call, which is who operated when nobody else is named.
 * Event markers ride the same log but are not contacts.
 */
export function contactTimes(qsos: Record<string, JSONValue>[]): Contacts {
  const times: number[] = [], operators = new Map<string, number[]>()
  for (const qso of qsos) {
    if (qso.band === 'event' || typeof qso.startAtMillis !== 'number' || !Number.isFinite(qso.startAtMillis)) continue
    times.push(qso.startAtMillis)
    const our = qso.our && typeof qso.our === 'object' && !Array.isArray(qso.our) ? qso.our : {}
    const operator = String(our.operatorCall || our.call || '').trim().toUpperCase()
    if (!operator) continue
    const list = operators.get(operator) ?? []
    if (!list.length) operators.set(operator, list)
    list.push(qso.startAtMillis)
  }
  for (const list of [times, ...operators.values()]) list.sort((a, b) => a - b)
  return { times, operators }
}

/** How many of the sorted [times] are at or before [t]. */
function countThrough(times: number[], t: number): number {
  let lo = 0, hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** QSOs per hour at [t], from the contacts in the [window] ending there. */
export function rateAt(times: number[], t: number, window: number): number {
  return (countThrough(times, t) - countThrough(times, t - window)) * HOUR / window
}

export type Extreme = { index: number; value: number }

/**
 * The highest and lowest of [rates], sampled at [samples]. A peak of 0 is no peak.
 *
 * The low only counts a sample whose whole window falls inside a run of
 * operating — contacts no further apart than the window itself. Without that,
 * the low would always sit in a break, or on the ramp up from the first
 * contact, where a trailing rate is low because the window is mostly empty
 * rather than because the operating was slow.
 */
export function extremes(samples: number[], rates: number[], times: number[], window: number): { peak?: Extreme; low?: Extreme } {
  let peak: Extreme | undefined, low: Extreme | undefined
  for (let i = 0; i < rates.length; i++) {
    if (rates[i] > 0 && (!peak || rates[i] > peak.value)) peak = { index: i, value: rates[i] }
  }
  const runs: [number, number][] = []
  for (const [i, time] of times.entries()) {
    if (i > 0 && time - times[i - 1] <= window) runs[runs.length - 1][1] = time
    else runs.push([time, time])
  }
  let run = 0
  for (let i = 0; i < samples.length; i++) {
    while (run < runs.length && runs[run][1] < samples[i]) run++
    if (run === runs.length) break
    if (samples[i] - window < runs[run][0]) continue
    if (!low || rates[i] < low.value) low = { index: i, value: rates[i] }
  }
  if (low && peak && low.value >= peak.value) low = undefined
  return { peak, low }
}

const FADE = 2

/**
 * QSOs per hour over the last [n] contacts at or before [t], the way the app's operation stats
 * give "Q/h for last 10": [n] over the time from the [n]th-last contact to the last. It needs
 * more than [n] contacts.
 *
 * Unlike the stats, it fades through a break, measured in the average gap between those
 * contacts: it holds for one gap, then falls along an exponential (k = 2) that reaches 0 at
 * [n] gaps. A fast run fades in minutes, a slow one over an hour.
 */
export function lastRate(times: number[], t: number, n: number): number | undefined {
  const count = countThrough(times, t)
  if (count <= n) return undefined
  const span = times[count - 1] - times[count - n]
  if (span <= 0) return undefined
  const rate = n * HOUR / span, gap = span / (n - 1)
  const x = (t - times[count - 1] - gap) / ((n - 1) * gap)
  if (x <= 0) return rate
  if (x >= 1) return 0
  return rate * (Math.exp(-FADE * x) - Math.exp(-FADE)) / (1 - Math.exp(-FADE))
}
