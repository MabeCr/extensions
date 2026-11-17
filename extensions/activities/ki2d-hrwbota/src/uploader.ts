// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// A host's side: the queue between the logging panel and the tracker's
// spotting API (`POST /api/v1/qsos` and `POST /api/v1/status`, with the
// host's own logger key as a Bearer token).
//
// Each contact goes to the tracker a couple of seconds after it is saved,
// with whatever else was saved meanwhile, in one request. The tracker knows a
// contact by the id the logger gives it, and sending the same id again edits
// it, so an edit is just a save. The save hook sees a new contact before the
// app gives it a uuid, so the id is the operation's uuid, the contact's start
// time and the listener's base call instead: what an edit keeps unless it
// moves the contact in time or corrects the call, and then the old id is
// deleted and the new one added.
//
// Deletions are noticed at the next save in the operation, as contacts the
// log no longer holds. Everything here lives in memory, so after a runtime
// restart the first save in an operation sends its whole log again, which the
// tracker answers as unchanged for what it already has; a contact deleted
// while the runtime was down stays on the tracker until the host deletes it
// there.
//
// A logged contact is also the host's status: on the air, on its frequency
// and mode, at the operation's references. That goes out with the contact
// when it differs from the last status sent, or when the last one is
// HEARTBEAT_MS old, so the tracker keeps the host on its spots feed while
// they keep logging. A self-spot sends it at once.
//
// The tracker credits whatever a key sends to the key's host, so before the
// first send with a key the queue asks the tracker whose it is, and sends
// only what was logged under that host's call. The rest is dropped, and the
// operator told once.
//
// A tracker that does not answer is tried again, backing off up to
// MAX_BACKOFF_MS; once it has failed for UNREACHABLE_NOTICE_MS with contacts
// waiting, the operator is told, since the queue lasts only while the app is
// open. Only a 400 for a whole request, which sending again cannot fix, drops
// what it carried, and says so.

import type { JSONValue } from "@ham2k/extension-sdk"

import { listenerExchange, sentSerial } from "./exchange.ts"
import { baseCall, wattsOf } from "./rules.ts"
import { API_BASE, parseJson } from "./tracker.ts"

export const SEND_DELAY_MS = 2 * 1000
export const BATCH_LIMIT = 200
export const HEARTBEAT_MS = 10 * 60 * 1000
/// A contact logged more than this far from now (typed in afterwards, or
/// imported) says nothing about where the host is now.
export const LIVE_MS = 10 * 60 * 1000
export const FIRST_BACKOFF_MS = 60 * 1000
export const MAX_BACKOFF_MS = 10 * 60 * 1000
export const MAX_REFS = 6
export const UNREACHABLE_NOTICE_MS = 10 * 60 * 1000
/// The longest contact id, and grid, the tracker takes.
export const MAX_ID_LENGTH = 64
export const MAX_GRID_LENGTH = 8

type Data = Record<string, JSONValue>

export interface FetchAnswer {
  status: number
  body: string
}

export interface UploaderDeps {
  fetch(url: string, options: { method: "GET" | "POST"; headers: Record<string, string>; body?: string; timeout: number }): Promise<FetchAnswer>
  now(): number
  setTimeout(callback: () => void, ms: number): unknown
  log(message: string): void
  /// A problem only the operator can fix; shown once per problem.
  tell(problem: Problem): void
}

export type Problem =
  | { key: "keyRefused" }
  | { key: "wrongKey"; call: string; owner: string }
  | { key: "rejected"; call: string; message: string }
  | { key: "batchRefused"; message: string }
  | { key: "statusRefused"; message: string }
  | { key: "unreachable" }

const idOf = (problem: Problem) => JSON.stringify(problem)

export interface StatusInput {
  state: "on_air" | "break" | "qrt"
  frequencyKhz: number | null
  mode: string | null
  channel: null
  note: string | null
  locationText: null
  grid: string | null
  refs: { type: string; ref: string }[]
}

export interface StatusResult {
  ok: boolean
  /// `retry`: the tracker could not be reached, or failed; `refused`: it
  /// read the status and said no, with a `message` for the operator;
  /// `wrongKey`: the key is `owner`'s, not the operation's host's.
  problem?: "keyRefused" | "retry" | "refused" | "wrongKey"
  message?: string
  owner?: string
}

interface Post {
  id: string
  operationUuid: string
  /// The base call of the operation it was logged in.
  station: string
  body: Data
}

function text(value: JSONValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function sub(value: JSONValue | undefined): Data {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Data) : {}
}

/// A contact as the log holds it, worth sending: not deleted, not an event
/// marker, with a call and a time.
export function isContact(qso: Data): boolean {
  return qso.deleted !== true && qso.band !== "event" && typeof qso.startAtMillis === "number" && !!text(sub(qso.their).call)
}

export function qsoId(operationUuid: string, qso: Data): string {
  const call = text(sub(qso.their).call) ?? ""
  const listener = baseCall(call) ?? call.toUpperCase()
  return `${operationUuid}:${(qso.startAtMillis as number).toString(36)}:${listener}`.slice(0, MAX_ID_LENGTH)
}

function stationOf(operation: Data): string {
  const call = text(operation.stationCall) ?? ""
  return baseCall(call) ?? call.toUpperCase()
}

/// The tracker's contact, from the app's (QSON), with the exchange the
/// host logged on its `type` ref.
export function qsoBody(id: string, qso: Data, type: string): Data {
  const our = sub(qso.our)
  const their = sub(qso.their)
  const body: Data = {
    id,
    call: text(their.call)!,
    time: qso.startAtMillis as number,
    mode: text(qso.mode) ?? "",
  }
  if (typeof qso.freq === "number" && qso.freq > 0) body.freq = qso.freq
  if (text(qso.band)) body.band = text(qso.band)!
  if (text(qso.submode)) body.submode = text(qso.submode)!
  const watts = wattsOf(qso.power)
  if (watts !== undefined) body.txPower = watts
  if (text(our.sent)) body.rstSent = text(our.sent)!
  if (text(their.sent)) body.rstRcvd = text(their.sent)!
  if (text(their.state)) body.state = text(their.state)!
  const serial = sentSerial(qso, type)
  if (serial !== undefined) body.serialSent = serial
  const exchange = listenerExchange(qso, type)
  if (exchange) body.exchange = exchange
  return body
}

/// The operation's own references (the parks, summits and the like it
/// activates), as the tracker's status carries them: `potaActivation` is
/// `pota`, which is also what a chaser's app calls the park they hunt.
export function statusRefs(operation: Data, ownType: string): { type: string; ref: string }[] {
  const refs = Array.isArray(operation.refs) ? (operation.refs as Data[]) : []
  const out: { type: string; ref: string }[] = []
  for (const ref of refs) {
    const type = text(ref?.type)
    const code = text(ref?.ref)
    if (!type || !code || type === ownType || !type.endsWith("Activation")) continue
    out.push({ type: type.slice(0, -"Activation".length).toLowerCase(), ref: code })
    if (out.length >= MAX_REFS) break
  }
  return out
}

export function statusFor(operation: Data, ownType: string, fields: { freq?: number; mode?: string; note?: string; state?: StatusInput["state"] }): StatusInput {
  return {
    state: fields.state ?? "on_air",
    frequencyKhz: typeof fields.freq === "number" && fields.freq > 0 ? fields.freq : null,
    mode: fields.mode?.trim() || null,
    channel: null,
    note: fields.note?.trim() || null,
    locationText: null,
    grid: text(operation.grid)?.slice(0, MAX_GRID_LENGTH) ?? null,
    refs: statusRefs(operation, ownType),
  }
}

export class Uploader {
  private key: string | undefined
  private refusedKey: string | undefined
  private posts = new Map<string, Post>()
  private deletions = new Map<string, string>()
  /// The ids the tracker holds, by operation.
  private held = new Map<string, Set<string>>()
  private swept = new Set<string>()
  /// Contacts sent without the serial the host sent: the later calls of a
  /// call list, which the logger numbers only after they are handed over.
  /// Each goes again once the log holds it with its serial.
  private serialless = new Set<string>()
  private status: StatusInput | undefined
  private statusStation = ""
  /// When a self-spot last took the host off the air (QRT): contacts logged
  /// before it no longer say the host is on the air.
  private offAirAt = -Infinity
  /// Counts self-spots, so a send that fails after one does not put back a
  /// status the self-spot replaced.
  private selfSpots = 0
  private lastStatus: { json: string; at: number } | undefined
  private timer: unknown = undefined
  private pausedUntil = -Infinity
  private backoffMs = 0
  private failingSince: number | undefined
  private sending = false
  /// The base call each key belongs to, as the tracker says.
  private owners = new Map<string, string>()
  private told = new Set<string>()
  private readonly deps: UploaderDeps
  private readonly ownType: string

  constructor(deps: UploaderDeps, ownType: string) {
    this.deps = deps
    this.ownType = ownType
  }

  get pending(): number {
    return this.posts.size + this.deletions.size + (this.status ? 1 : 0)
  }

  /// A contact about to be saved, and the log as it stands, which does not
  /// hold that contact yet and, for an edit, holds it as it was. Without a
  /// log (an app that hands the hook no operation uuid) the contact is only
  /// sent: deletions and moves in time go unnoticed.
  saving(args: { key: string; operation: Data; qso: Data; log?: Data[] }): void {
    const { operation, qso, log } = args
    this.useKey(args.key)
    const operationUuid = text(operation.uuid) ?? ""
    const station = stationOf(operation)
    const id = isContact(qso) ? qsoId(operationUuid, qso) : undefined

    if (log && operationUuid) this.reconcile(operationUuid, station, qso, log)
    if (id) this.post(operationUuid, station, id, qso)
    else if (qso.deleted === true && typeof qso.startAtMillis === "number") this.remove(operationUuid, qsoId(operationUuid, qso))

    const at = qso.startAtMillis
    if (id && typeof at === "number" && Math.abs(this.deps.now() - at) <= LIVE_MS && at > this.offAirAt) {
      this.queueStatus(statusFor(operation, this.ownType, { freq: qso.freq as number, mode: text(qso.mode) }), station)
    }
    this.schedule(SEND_DELAY_MS)
  }

  private reconcile(operationUuid: string, station: string, qso: Data, log: Data[]): void {
    const present = new Set(log.filter(isContact).map((stored) => qsoId(operationUuid, stored)))
    for (const id of this.heldBy(operationUuid)) if (!present.has(id)) this.remove(operationUuid, id)

    const before = text(qso.uuid) ? log.find((stored) => stored.uuid === qso.uuid) : undefined
    if (before && isContact(before)) {
      const was = qsoId(operationUuid, before)
      if (!isContact(qso) || was !== qsoId(operationUuid, qso)) this.remove(operationUuid, was)
    }

    if (this.serialless.size > 0) {
      for (const stored of log) {
        if (!isContact(stored) || (text(qso.uuid) && stored.uuid === qso.uuid)) continue
        const id = qsoId(operationUuid, stored)
        if (this.serialless.has(id) && sentSerial(stored, this.ownType) !== undefined) this.post(operationUuid, station, id, stored)
      }
    }

    if (!this.swept.has(operationUuid)) {
      this.swept.add(operationUuid)
      for (const stored of log) {
        if (!isContact(stored) || (text(qso.uuid) && stored.uuid === qso.uuid)) continue
        const id = qsoId(operationUuid, stored)
        if (!this.posts.has(id)) this.post(operationUuid, station, id, stored)
      }
    }
  }

  /// A self-spot: the status goes out now, and the answer is the operator's.
  async selfSpot(args: { key: string; operation: Data; freq: number; mode?: string; comment?: string }): Promise<StatusResult> {
    this.useKey(args.key)
    const owner = await this.ownerOf(args.key)
    if (owner === undefined) return { ok: false, problem: args.key === this.refusedKey ? "keyRefused" : "retry" }
    const station = stationOf(args.operation)
    if (station !== owner) return { ok: false, problem: "wrongKey", owner }
    const comment = args.comment?.trim() ?? ""
    const state = /^QRT\b/i.test(comment) ? "qrt" : "on_air"
    const status = statusFor(args.operation, this.ownType, { freq: args.freq, mode: args.mode, note: comment, state })
    this.status = undefined
    this.selfSpots++
    const result = await this.sendStatus(args.key, status)
    if (result.ok) this.offAirAt = state === "qrt" ? this.deps.now() : -Infinity
    return result
  }

  /// A key the tracker just named the host of, in the account's check: a
  /// refusal of that same key is over. The key in use stays the saved one,
  /// which the next save hands over.
  keyAccepted(key: string, call: string): void {
    this.owners.set(key, baseCall(call) ?? call.toUpperCase())
    if (key === this.refusedKey) {
      this.refusedKey = undefined
      this.told.delete(idOf({ key: "keyRefused" }))
    }
    this.schedule(0)
  }

  private useKey(key: string): void {
    if (key !== this.key) this.told.delete(idOf({ key: "keyRefused" }))
    this.key = key
  }

  /// The base call of the key's host, asking the tracker the first time;
  /// undefined while it can't say (the key refused, or no answer).
  private async ownerOf(key: string): Promise<string | undefined> {
    const known = this.owners.get(key)
    if (known) return known
    const answer = await this.request(key, "/me")
    if (!answer) return undefined
    if (answer.status === 401) {
      this.refused(key)
      return undefined
    }
    const call = text(sub(sub(parseJson(answer.body) ?? {}).host).call)
    if (answer.status !== 200 || !call) {
      this.deps.log(`HRWBOTA: /me → ${answer.status} ${answer.body.slice(0, 300)}`)
      return undefined
    }
    const owner = baseCall(call) ?? call.toUpperCase()
    this.owners.set(key, owner)
    return owner
  }

  private heldBy(operationUuid: string): Set<string> {
    let ids = this.held.get(operationUuid)
    if (!ids) this.held.set(operationUuid, (ids = new Set()))
    return ids
  }

  private post(operationUuid: string, station: string, id: string, qso: Data): void {
    this.deletions.delete(id)
    const body = qsoBody(id, qso, this.ownType)
    if (body.serialSent === undefined) this.serialless.add(id)
    else this.serialless.delete(id)
    this.posts.set(id, { id, operationUuid, station, body })
  }

  private remove(operationUuid: string, id: string): void {
    this.posts.delete(id)
    this.serialless.delete(id)
    this.heldBy(operationUuid).delete(id)
    this.deletions.set(id, operationUuid)
  }

  private queueStatus(status: StatusInput, station: string): void {
    const json = JSON.stringify(status)
    const last = this.lastStatus
    if (last && last.json === json && this.deps.now() - last.at < HEARTBEAT_MS) return
    this.status = status
    this.statusStation = station
  }

  /// One send at a time: a save while one is out waits for it to finish.
  private schedule(delayMs: number): void {
    if (this.timer !== undefined || this.sending || this.pending === 0) return
    if (!this.key || this.key === this.refusedKey) return
    const now = this.deps.now()
    const at = Math.max(now + delayMs, this.pausedUntil)
    this.timer = this.deps.setTimeout(() => {
      this.timer = undefined
      this.sending = true
      void this.drain()
        .catch((error: unknown) => {
          this.deps.log(`HRWBOTA: sending failed: ${error instanceof Error ? error.message : String(error)}`)
          this.failed()
        })
        .finally(() => {
          this.sending = false
          this.schedule(0)
        })
    }, at - now)
  }

  /// One request for contacts (deletions first), then the status, if any.
  async drain(): Promise<void> {
    const key = this.key
    if (!key || key === this.refusedKey) return
    const owner = await this.ownerOf(key)
    if (owner === undefined) {
      if (key !== this.refusedKey) this.failed()
      return
    }
    this.dropOthers(owner)
    if (this.posts.size || this.deletions.size) {
      if (!(await this.sendQsos(key))) return
    }
    const status = this.status
    if (status) {
      this.status = undefined
      const selfSpots = this.selfSpots
      const result = await this.sendStatus(key, status)
      if (result.problem === "retry" && selfSpots === this.selfSpots) this.status ??= status
      else if (result.problem === "refused") this.tellOnce({ key: "statusRefused", message: result.message ?? "" })
    }
  }

  /// What was logged under a call other than the key's host's would count
  /// for that host: it is not sent. Its operation's next save sends its whole
  /// log again, so once the key or the call is fixed nothing stays behind.
  private dropOthers(owner: string): void {
    for (const post of [...this.posts.values()]) {
      if (post.station === owner) continue
      this.posts.delete(post.id)
      this.swept.delete(post.operationUuid)
      this.tellOnce({ key: "wrongKey", call: post.station, owner })
    }
    if (this.status && this.statusStation !== owner) {
      this.status = undefined
      this.tellOnce({ key: "wrongKey", call: this.statusStation, owner })
    }
  }

  private async request(key: string, path: string, body?: JSONValue): Promise<FetchAnswer | undefined> {
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${key}`, Accept: "application/json" }
      if (body === undefined) return await this.deps.fetch(`${API_BASE}/v1${path}`, { method: "GET", headers, timeout: 20 * 1000 })
      return await this.deps.fetch(`${API_BASE}/v1${path}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        timeout: 20 * 1000,
      })
    } catch (error) {
      this.deps.log(`HRWBOTA: ${path} failed: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  /// False when nothing more should go out until the next try.
  private async sendQsos(key: string): Promise<boolean> {
    const deletions = [...this.deletions.entries()].slice(0, BATCH_LIMIT)
    const posts = [...this.posts.values()].slice(0, BATCH_LIMIT - deletions.length)
    const items: JSONValue[] = [...deletions.map(([id]) => ({ id, deleted: true })), ...posts.map((post) => post.body)]
    const answer = await this.request(key, "/qsos", { qsos: items })
    if (!answer) return this.failed()
    this.deps.log(`HRWBOTA: /qsos (${items.length}) → ${answer.status} ${answer.body.slice(0, 300)}`)
    if (answer.status === 401) return this.refused(key)
    // Anything but a verdict on the request itself (a proxy's refusal, a
    // page that moved, an outage) says nothing about the contacts: try again.
    if (answer.status !== 200 && answer.status !== 400) return this.failed()

    if (answer.status === 400) {
      // The whole request was refused as malformed; sending it again would be
      // refused the same way.
      for (const [id] of deletions) this.deletions.delete(id)
      for (const post of posts) if (this.posts.get(post.id) === post) this.posts.delete(post.id)
      this.recovered()
      this.tellOnce({ key: "batchRefused", message: text(parseJson(answer.body)?.message) ?? answer.body.slice(0, 200) })
      return true
    }
    // A 200 that is not the tracker's answer (a Wi-Fi sign-in page, a proxy)
    // took nothing: try again.
    const results = parseJson(answer.body)?.results
    if (!Array.isArray(results)) return this.failed()
    this.recovered()
    const byId = new Map<string, Data>()
    for (const r of results) if (r && typeof r === "object" && !Array.isArray(r)) byId.set(String((r as Data).id), r as Data)
    for (const [id] of deletions) if (byId.has(id)) this.deletions.delete(id)
    for (const post of posts) {
      const result = byId.get(post.id)
      const outcome = text(result?.result)
      // Without an outcome it goes again with the next request.
      if (outcome && this.posts.get(post.id) === post) this.posts.delete(post.id)
      if (outcome === "added" || outcome === "updated" || outcome === "unchanged") this.heldBy(post.operationUuid).add(post.id)
      else if (outcome === "rejected") this.tellOnce({ key: "rejected", call: String(post.body.call), message: text(result?.problem) ?? "rejected" })
      else if (outcome === "duplicate") this.deps.log(`HRWBOTA: ${post.body.call} at ${post.id} is a duplicate of another contact`)
    }
    // An answer naming none of what was sent took nothing: wait before the next try.
    if (!items.length || [...deletions.map(([id]) => id), ...posts.map((post) => post.id)].some((id) => byId.has(id))) return true
    return this.failed()
  }

  private async sendStatus(key: string, status: StatusInput): Promise<StatusResult> {
    const answer = await this.request(key, "/status", status as unknown as JSONValue)
    if (!answer) {
      this.failed()
      return { ok: false, problem: "retry" }
    }
    if (answer.status === 401) {
      this.refused(key)
      return { ok: false, problem: "keyRefused" }
    }
    const sent = { json: JSON.stringify(status), at: this.deps.now() }
    if (answer.status !== 200) {
      const message = text(parseJson(answer.body)?.message) ?? `HTTP ${answer.status}`
      this.deps.log(`HRWBOTA: /status → ${answer.status} ${message}`)
      if (answer.status !== 400) {
        this.failed()
        return { ok: false, problem: "retry", message }
      }
      // Refused as it stands: not sent again until it changes.
      this.lastStatus = sent
      this.recovered()
      return { ok: false, problem: "refused", message }
    }
    if (parseJson(answer.body)?.ok !== true) {
      // Not the tracker's answer (a Wi-Fi sign-in page, a proxy): try again.
      this.failed()
      return { ok: false, problem: "retry" }
    }
    this.lastStatus = sent
    this.recovered()
    return { ok: true }
  }

  private refused(key: string): false {
    this.refusedKey = key
    this.tellOnce({ key: "keyRefused" })
    return false
  }

  /// The tracker did not answer, or failed: wait, then try again.
  private failed(): false {
    const now = this.deps.now()
    this.failingSince ??= now
    if (now - this.failingSince >= UNREACHABLE_NOTICE_MS && this.pending > 0) this.tellOnce({ key: "unreachable" })
    this.backoffMs = Math.min(MAX_BACKOFF_MS, this.backoffMs ? this.backoffMs * 2 : FIRST_BACKOFF_MS)
    this.pausedUntil = now + this.backoffMs
    return false
  }

  private recovered(): void {
    this.backoffMs = 0
    this.failingSince = undefined
    this.told.delete(idOf({ key: "unreachable" }))
  }

  private tellOnce(problem: Problem): void {
    const id = idOf(problem)
    if (this.told.has(id)) return
    this.told.add(id)
    this.deps.tell(problem)
  }
}
