// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The QSY rule (11), as a message on the FYI line that says how much further
// to move:
//
//   "If any station solicits a call (eg, by sending "CQ," "QRZ?" "going up
//   5 kHz" or any other means of soliciting a response, including completion
//   of a contact where the frequency was inherited), that station is
//   permitted to work only one station in response to that solicitation.
//   The station must thereafter move at least 1 kHz before calling another
//   station, or at least 5 kHz before soliciting other calls. Once a station
//   is required to QSY, that station is not allowed to make another contact
//   on the vacated frequency until or unless at least one subsequent contact
//   is made on a new frequency."
//
// WHO SOLICITED is not in the log: HaLo's Run and S&P switch is the keyer's,
// and never reaches the contact or an extension. What the log does prove is
// two contacts in a row on one frequency — the second was solicited, by a CQ
// or by the frequency inherited from the first — and then the message says
// so. After a single contact it is hedged, "unless you answered a CQ": the
// operator knows which it was, and the distance is what they came to read.
//
// Under SO2R each radio keeps its own: a contact on Radio B is judged against
// the one before it on B, and its message shows in B's set alone.
//
// After each new contact the radio's dial is read once a second, and the
// message follows it as it turns: so far to call, so far to CQ, gone from
// 5 kHz out, and back if the dial returns to the vacated frequency before
// another contact. Without a radio to read there is no distance, so a proven
// duty gets the rule alone, for a minute.

import type { FyiCategory, FyiMessageParams, FyiPriority, JSONValue } from "@ham2k/extension-sdk"
import { fmtFreq } from "@ham2k/lib-format-tools"

/// "move at least 1 kHz before calling another station"
export const CALL_QSY_HZ = 1000
/// "or at least 5 kHz before soliciting other calls"
export const CQ_QSY_HZ = 5000

/// How often the dial is read while a duty stands.
export const READ_EVERY_MILLIS = 1000

/// How long a contact's duty is watched without a next contact. The rule has
/// no end, but an operator who stopped for a sandwich doesn't need the radio
/// read every second until the Sprint is over.
export const WATCH_MILLIS = 15 * 60 * 1000

/// A contact saved this long after it started is a log being edited or
/// imported, not the contact just made.
export const RECENT_MILLIS = 5 * 60 * 1000

/// How long the rule alone stays up when there is no dial to follow.
const NO_RADIO_SECONDS = 60

const ICON = 'swap-horizontal'

/// The SO2R set a contact was logged from — `our.radio`, which HaLo stamps
/// on every contact under SO2R — and A for one logged without it, Radio A
/// being the only radio there is.
export type QsySet = 'A' | 'B'

export function setOf(qso: Record<string, JSONValue> | undefined): QsySet {
  const our = qso?.our
  return our && typeof our === 'object' && !Array.isArray(our) && our.radio === 'B' ? 'B' : 'A'
}

/// The set a contact NAMES, for the message's `radio`: under SO2R a message
/// about one radio shows in that radio's set alone; without it, there is one
/// set and the message names none.
function namedSet(qso: Record<string, JSONValue>): QsySet | undefined {
  const our = qso.our
  const radio = our && typeof our === 'object' && !Array.isArray(our) ? our.radio : undefined
  return radio === 'A' || radio === 'B' ? radio : undefined
}

/// `must`: the log proves this contact was solicited. `maybe`: it was,
/// unless it answered someone else's CQ.
export type QsyDuty = 'must' | 'maybe'

/// What the watcher needs of the app, so the tests can stand in for it.
export interface QsyHost {
  readRadio(): Promise<{ status: string; stale?: boolean; frequencyHz: number | null } | null>
  post(params: FyiMessageParams): Promise<void>
  clear(key: string): Promise<void>
  setInterval(fn: () => void, ms: number): number
  clearInterval(id: number): void
}

type Translate = (key: string, options?: Record<string, unknown>) => string

interface Watch {
  duty: QsyDuty
  radio: QsySet | undefined
  anchorHz: number
  startedMillis: number
  /// The dial has been a call's distance away, so the anchor is now the
  /// VACATED frequency, and coming back to it is what the rule forbids.
  left: boolean
  t: Translate
}

function num(value: JSONValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/// What a just-made contact obliges, given the contact before it: `must`
/// when that one was on the same frequency, within a call's distance.
/// Undefined for a contact with no frequency.
export function dutyAfter(qso: Record<string, JSONValue>, previous: Record<string, JSONValue> | undefined): QsyDuty | undefined {
  const freq = num(qso.freq)
  if (freq === undefined) return undefined
  const before = num(previous?.freq)
  return before !== undefined && Math.abs(before - freq) * 1000 < CALL_QSY_HZ ? 'must' : 'maybe'
}

/// The contact logged before [qso] in [qsos], on the same radio — the
/// operation's log as the app holds it, which may already include [qso]
/// itself.
export function previousContact(qsos: Record<string, JSONValue>[], qso: Record<string, JSONValue>): Record<string, JSONValue> | undefined {
  const at = num(qso.startAtMillis) ?? Infinity
  const set = setOf(qso)
  let previous: Record<string, JSONValue> | undefined
  for (const other of qsos) {
    if (other.band === 'event' || (qso.uuid && other.uuid === qso.uuid) || setOf(other) !== set) continue
    const otherAt = num(other.startAtMillis)
    if (otherAt === undefined || otherAt >= at) continue
    if (!previous || otherAt > num(previous.startAtMillis)!) previous = other
  }
  return previous
}

/// "0.4" — kHz still to go, rounded UP, so it never reads 0.0 short of it.
function khzToGo(hz: number): string {
  return (Math.ceil(hz / 100) / 10).toFixed(1)
}

/// The message for a dial [distanceHz] from the anchor, or undefined when
/// there is nothing left to say.
export function qsyMessage(
  watch: Pick<Watch, 'duty' | 'anchorHz' | 'left'>,
  distanceHz: number | undefined,
  t: Translate,
): { category: FyiCategory; priority: FyiPriority; text: string; expiresInSeconds?: number } | undefined {
  const must = watch.duty === 'must'
  const lead = t(must ? 'qsyMust' : 'qsyMaybe')
  const say = (category: FyiCategory, body: string, expiresInSeconds?: number) => ({
    category: must ? category : 'info' as FyiCategory,
    priority: (must ? 'normal' : 'low') as FyiPriority,
    text: `**${lead}:** ${body}`,
    ...(expiresInSeconds ? { expiresInSeconds } : {}),
  })

  if (distanceHz === undefined) return must ? say('warning', t('qsyRule'), NO_RADIO_SECONDS) : undefined
  if (distanceHz < CALL_QSY_HZ) {
    return watch.left
      ? say('warning', t('qsyVacated', { freq: fmtFreq(watch.anchorHz / 1000) }))
      : say('warning', t('qsyToCall', { call: khzToGo(CALL_QSY_HZ - distanceHz), cq: khzToGo(CQ_QSY_HZ - distanceHz) }))
  }
  if (distanceHz < CQ_QSY_HZ) return say('info', t('qsyToCq', { cq: khzToGo(CQ_QSY_HZ - distanceHz) }))
  return undefined
}

/// What `shown` holds when the line's state is not known — a post or clear
/// that failed — so the next message, or the next clear, is always sent.
const UNKNOWN = '?'

/// One radio's duty: its latest contact's, replacing the one before.
export class QsyWatcher {
  private watch: Watch | undefined
  private timer: number | undefined
  private shown: string | undefined
  /// Readings are numbered so an answer that comes back late never
  /// overwrites a newer one, and a tick waits for the reading under way.
  private readings = 0
  private applied = 0
  private reading = false
  /// A failure that would repeat once a second is said once, until it clears.
  private radioWarned = false
  private lineWarned = false

  private readonly host: QsyHost
  private readonly now: () => number
  /// The FYI key: one message per radio.
  private readonly key: string

  constructor(host: QsyHost, now: () => number = Date.now, key = 'qsy') {
    this.host = host
    this.now = now
    this.key = key
  }

  /// The last contact watched — the contact before the next one, when the
  /// log can't be read for it.
  lastContact: Record<string, JSONValue> | undefined

  /// A contact was just logged; [previous] is the one before it.
  async contact(qso: Record<string, JSONValue>, previous: Record<string, JSONValue> | undefined, t: Translate): Promise<void> {
    this.lastContact = qso
    const duty = dutyAfter(qso, previous)
    if (!duty) return this.stop()
    this.watch = { duty, radio: namedSet(qso), anchorHz: num(qso.freq)! * 1000, startedMillis: this.now(), left: false, t }
    // Every contact posts its first message, even one reading the same as
    // the last: that one may have expired, or been put away by the operator.
    if (this.shown !== undefined) this.shown = UNKNOWN
    if (this.timer === undefined) this.timer = this.host.setInterval(() => this.tick(), READ_EVERY_MILLIS)
    await this.read()
  }

  async stop(): Promise<void> {
    if (this.timer !== undefined) this.host.clearInterval(this.timer)
    this.timer = undefined
    this.watch = undefined
    await this.show(undefined)
  }

  private tick(): void {
    if (this.reading) return
    this.read().catch((e) => console.warn('[ssb-sprint] QSY reading failed:', e))
  }

  /// One reading of the dial, and the message it calls for.
  async read(): Promise<void> {
    const watch = this.watch
    if (!watch) return
    if (this.now() - watch.startedMillis > WATCH_MILLIS) return this.stop()

    const reading = ++this.readings
    let distanceHz: number | undefined
    this.reading = true
    try {
      const radio = await this.host.readRadio()
      // A stale frequency is the last one the radio reported, not where the
      // dial is.
      if (radio?.status === 'connected' && !radio.stale && typeof radio.frequencyHz === 'number') {
        distanceHz = Math.abs(radio.frequencyHz - watch.anchorHz)
      }
      this.radioWarned = false
    } catch (e) {
      if (!this.radioWarned) console.warn('[ssb-sprint] radio unreadable, QSY distance unknown:', e)
      this.radioWarned = true
    } finally {
      this.reading = false
    }
    if (watch !== this.watch || reading < this.applied) return
    this.applied = reading
    if (distanceHz !== undefined && distanceHz >= CALL_QSY_HZ) watch.left = true
    const message = qsyMessage(watch, distanceHz, watch.t)
    await this.show(message && { ...message, ...(watch.radio ? { radio: watch.radio } : {}) })
  }

  /// Posts [message] when it differs from the one up, clears when there is
  /// none — the line coalesces posts anyway, but the bridge needn't carry
  /// the same text every second.
  private async show(message: (ReturnType<typeof qsyMessage> & { radio?: QsySet }) | undefined): Promise<void> {
    const shown = message && JSON.stringify(message)
    if (shown === this.shown) return
    this.shown = shown
    try {
      if (message) await this.host.post({ key: this.key, icon: ICON, ...message })
      else await this.host.clear(this.key)
      this.lineWarned = false
    } catch (e) {
      this.shown = UNKNOWN
      if (!this.lineWarned) console.warn('[ssb-sprint] FYI line unavailable, QSY message not shown:', e)
      this.lineWarned = true
    }
  }
}
