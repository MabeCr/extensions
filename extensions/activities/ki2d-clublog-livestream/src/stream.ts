// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The queue between the logging panel and Club Log's REST API
// (https://clublog.org/support/knowledgebase/rest-api/for-llms/club-log-api-information-for-llms/).
//
// A Live Stream shows what reaches the station's Club Log log, so feeding it
// is uploading each contact as it is logged: `POST /api/v1/qso/batch`, one
// ADIF record per contact, with the operator's own `cl_` token. Club Log
// documents no Live Stream write of its own.
//
// What the API allows shapes the pacing: 60 requests a minute and 1,000 a
// UTC day per account, a batch of up to 100 contacts counting as one. A
// request goes out as soon as there is something to send and none went out
// in the last MIN_GAP_MS, the cadence Club Log's own Gateway keeps. That
// holds while what is left of the day's allowance could still cover the rest
// of the UTC day at one request per SLOW_GAP_MS; past that, what is left is
// spread evenly to midnight, so a 24-hour contest is still streaming at
// 23:59. Club Log's rules for what not to resend are followed
// to the letter: a 401 stops everything until the token changes, a 422 or a
// rejected contact is never sent again, a 429 waits what it says.
//
// Contacts are known by `signatureOf`, not uuid: the save hook sees a new
// contact before the app gives it one. Everything here lives in memory —
// the host's key-value store does too, and holds 4 KB — so a runtime restart
// forgets the queue and which contacts have Club Log ids. `sweep` covers the
// first: the save after a restart sends the operation's last hour again,
// which Club Log answers as duplicates. The second costs the edits and
// deletions of contacts sent before the restart, which stay on Club Log as
// they were sent.

import type { JSONValue } from "@ham2k/extension-sdk"

export const API_BASE = "https://clublog.org/api/v1"

export const MIN_GAP_MS = 30 * 1000
export const SLOW_GAP_MS = 5 * 60 * 1000
export const BATCH_LIMIT = 100
/// Club Log's usual daily allowance, less a margin for the operator's other
/// clients and for the account check.
export const DAILY_REQUESTS = 950
/// How long a server or network failure waits before the next try: Club Log
/// asks that a write that may have applied is not repeated at once.
export const FIRST_BACKOFF_MS = 2 * 60 * 1000
export const MAX_BACKOFF_MS = 15 * 60 * 1000
/// How far back `sweep` reaches. Club Log lists a Live Stream for 45 minutes
/// after its latest contact.
export const SWEEP_MS = 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

type Qso = Record<string, JSONValue>

export interface Post {
  kind: "post"
  signature: string
  operationUuid: string
  call: string
  qso: Qso
  operation: Qso
}

export interface Deletion {
  kind: "delete"
  signature: string
  operationUuid: string
  qsoid: number
}

export type Job = Post | Deletion

export interface FetchAnswer {
  status: number
  body: string
}

export interface StreamDeps {
  fetch(url: string, options: { method: "POST"; headers: Record<string, string>; body: string; timeout: number }): Promise<FetchAnswer>
  /// One contact as one ADIF record, ending `<EOR>`.
  adif(qso: Qso, operation: Qso): Promise<string>
  now(): number
  setTimeout(callback: () => void, ms: number): unknown
  log(message: string): void
  /// A problem only the operator can fix, worded by `problem`; shown once per
  /// key until it changes.
  tell(problem: Problem): void
}

export type Problem =
  | { key: "tokenRefused" }
  | { key: "callRefused"; call: string; message: string }
  | { key: "rejected"; call: string; theirCall: string; message: string }

/// What Club Log matches a contact on, so a contact keeps it from the save
/// hook (no uuid yet) to the log (`ctx.getQsos`). An edit that changes any of
/// it is, to Club Log, a different contact.
export function signatureOf(qso: Qso): string | undefined {
  const their = qso.their as Record<string, JSONValue> | undefined
  const call = typeof their?.call === "string" ? their.call.trim().toUpperCase() : ""
  const at = qso.startAtMillis
  if (!call || typeof at !== "number" || qso.band === "event") return undefined
  return [at, call, qso.band ?? "", qso.mode ?? ""].join("|")
}

function isUploadable(qso: Qso): boolean {
  return qso.deleted !== true && signatureOf(qso) !== undefined
}

export class Stream {
  private queue: Job[] = []
  /// Club Log's id for each contact it holds, by operation then signature.
  private ids = new Map<string, Map<string, number>>()
  private swept = new Set<string>()
  private token: string | undefined
  private refusedToken: string | undefined
  private lastSentAt = -Infinity
  private pausedUntil = -Infinity
  private backoffMs = 0
  private day = -1
  private sentToday = 0
  private timer: unknown = undefined
  private told = new Set<string>()
  private readonly deps: StreamDeps

  constructor(deps: StreamDeps) {
    this.deps = deps
  }

  /// What the save hook knows when a contact is about to be written: the
  /// contact as it will be saved, and the operation's log as it stands, which
  /// does not hold that contact yet and, for an edit, holds it as it was.
  ///
  /// Without a `log` — the app hands the save hook its operation without a
  /// uuid, so there is no log to read — each save is only sent: an edit that
  /// changes what Club Log matches on leaves the old contact there, and a
  /// deletion never reaches it. Reconciling against an empty log instead
  /// would read every contact already sent as deleted.
  saving(args: { token: string; operation: Qso; qso: Qso; log?: Qso[] }): void {
    const { operation, qso, log } = args
    const operationUuid = String(operation.uuid ?? "")
    if (args.token !== this.token) this.told.delete("tokenRefused")
    this.token = args.token
    const call = String(operation.stationCall ?? "").trim().toUpperCase()
    const signature = isUploadable(qso) ? signatureOf(qso) : undefined

    if (log && operationUuid) this.reconcile(operationUuid, call, operation, qso, log)

    if (signature && call) this.post({ kind: "post", signature, operationUuid, call, qso, operation })
    this.schedule()
  }

  private reconcile(operationUuid: string, call: string, operation: Qso, qso: Qso, log: Qso[]): void {
    const ids = this.idsFor(operationUuid)
    const before = typeof qso.uuid === "string" ? log.find((stored) => stored.uuid === qso.uuid) : undefined

    // A deletion is noticed at the next save in the operation: nothing tells
    // an extension a contact went away, but the log no longer holds it.
    const present = new Set(log.filter(isUploadable).map((stored) => signatureOf(stored)))
    for (const [signature, qsoid] of ids) {
      if (!present.has(signature)) this.remove(operationUuid, signature, qsoid)
    }
    // Every earlier save has been written by now, so a contact still waiting
    // that the log lacks was deleted, or its save failed.
    this.queue = this.queue.filter((job) => job.kind !== "post" || job.operationUuid !== operationUuid || present.has(job.signature))

    const signature = isUploadable(qso) ? signatureOf(qso) : undefined
    const was = before && isUploadable(before) ? signatureOf(before) : undefined
    if (was && was !== signature) {
      const qsoid = ids.get(was)
      if (qsoid !== undefined) this.remove(operationUuid, was, qsoid)
      this.queue = this.queue.filter((job) => !(job.kind === "post" && job.operationUuid === operationUuid && job.signature === was))
    }

    if (call && !this.swept.has(operationUuid)) {
      this.swept.add(operationUuid)
      const since = this.deps.now() - SWEEP_MS
      for (const stored of log) {
        if (stored.uuid === qso.uuid || !isUploadable(stored) || (stored.startAtMillis as number) < since) continue
        if (ids.has(signatureOf(stored)!)) continue
        this.post({ kind: "post", signature: signatureOf(stored)!, operationUuid, call, qso: stored, operation })
      }
    }
  }

  /// How many jobs wait, for tests and the log.
  get pending(): number {
    return this.queue.length
  }

  private idsFor(operationUuid: string): Map<string, number> {
    let ids = this.ids.get(operationUuid)
    if (!ids) this.ids.set(operationUuid, (ids = new Map()))
    return ids
  }

  /// The latest save of a contact replaces any earlier one still waiting.
  private post(job: Post): void {
    this.queue = this.queue.filter((queued) => !(queued.kind === "post" && queued.operationUuid === job.operationUuid && queued.signature === job.signature))
    this.queue.push(job)
  }

  private remove(operationUuid: string, signature: string, qsoid: number): void {
    this.idsFor(operationUuid).delete(signature)
    this.queue.push({ kind: "delete", signature, operationUuid, qsoid })
  }

  private gapMs(now: number): number {
    this.rollDay(now)
    const left = DAILY_REQUESTS - this.sentToday
    const untilMidnight = DAY_MS - (now % DAY_MS)
    if (left <= 0) return untilMidnight
    if (left > untilMidnight / SLOW_GAP_MS) return MIN_GAP_MS
    return Math.max(MIN_GAP_MS, Math.ceil(untilMidnight / left))
  }

  private rollDay(now: number): void {
    const day = Math.floor(now / DAY_MS)
    if (day !== this.day) {
      this.day = day
      this.sentToday = 0
    }
  }

  private schedule(): void {
    if (this.timer !== undefined || this.queue.length === 0) return
    if (!this.token || this.token === this.refusedToken) return
    const now = this.deps.now()
    const at = Math.max(this.lastSentAt + this.gapMs(now), this.pausedUntil)
    this.timer = this.deps.setTimeout(() => {
      this.timer = undefined
      void this.drain().finally(() => this.schedule())
    }, Math.max(0, at - now))
  }

  /// One request: the deletions waiting, or else up to BATCH_LIMIT contacts.
  async drain(): Promise<void> {
    const token = this.token
    if (!token || token === this.refusedToken || this.queue.length === 0) return
    const deletions = this.queue.filter((job): job is Deletion => job.kind === "delete")
    const batch = deletions.length ? deletions.slice(0, BATCH_LIMIT) : (this.queue.filter((job) => job.kind === "post") as Post[]).slice(0, BATCH_LIMIT)

    let request: { path: string; body: JSONValue; items: Job[] }
    if (batch[0].kind === "delete") {
      request = { path: "/qso/deletions", body: { qsoids: (batch as Deletion[]).map((job) => job.qsoid) }, items: batch }
    } else {
      const items: Post[] = []
      const qsos: JSONValue[] = []
      for (const job of batch as Post[]) {
        try {
          qsos.push({ call: job.call, adif: await this.deps.adif(job.qso, job.operation) })
          items.push(job)
        } catch (error) {
          // A contact the exporter cannot write is not one a retry will fix.
          this.deps.log(`Club Log: no ADIF for ${job.signature}: ${error instanceof Error ? error.message : String(error)}`)
          this.drop([job])
        }
      }
      if (items.length === 0) return
      request = { path: "/qso/batch", body: { qsos }, items }
    }

    const now = this.deps.now()
    this.rollDay(now)
    this.lastSentAt = now
    this.sentToday += 1
    let answer: FetchAnswer
    try {
      answer = await this.deps.fetch(`${API_BASE}${request.path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request.body),
        timeout: 20 * 1000,
      })
    } catch (error) {
      this.deps.log(`Club Log: ${request.path} failed: ${error instanceof Error ? error.message : String(error)}`)
      this.backOff()
      return
    }
    this.deps.log(`Club Log: ${request.path} (${request.items.length}) → ${answer.status} ${answer.body.slice(0, 500)}`)
    this.answered(token, request.items, answer)
  }

  private answered(token: string, items: Job[], answer: FetchAnswer): void {
    const body = parse(answer.body)
    const error = (body?.error ?? undefined) as Record<string, JSONValue> | undefined
    const message = typeof error?.message === "string" ? error.message : `HTTP ${answer.status}`

    if (answer.status === 200 || answer.status === 201) {
      this.backoffMs = 0
      const results = Array.isArray(body?.results) ? (body.results as Record<string, JSONValue>[]) : []
      items.forEach((job, index) => this.settle(job, results[index]))
      this.drop(items)
      return
    }
    if (answer.status === 401) {
      this.refusedToken = token
      this.tell({ key: "tokenRefused" })
      return
    }
    if (answer.status === 403) {
      // The callsign is not on the token's account; nothing for it will pass.
      const calls = new Set(items.flatMap((job) => (job.kind === "post" ? [job.call] : [])))
      for (const call of calls) this.tell({ key: "callRefused", call, message })
      this.queue = this.queue.filter((job) => !(job.kind === "post" && calls.has(job.call)))
      this.drop(items)
      return
    }
    if (answer.status === 429) {
      const details = (error?.details ?? undefined) as Record<string, JSONValue> | undefined
      const seconds = Number(details?.retry_after)
      this.pausedUntil = this.deps.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60 * 1000)
      return
    }
    if (answer.status === 422) {
      this.deps.log(`Club Log refused the request: ${message}`)
      for (const job of items) if (job.kind === "post") this.tellRejected(job, message)
      this.drop(items)
      return
    }
    this.deps.log(`Club Log: ${message}`)
    this.backOff()
  }

  private settle(job: Job, result: Record<string, JSONValue> | undefined): void {
    const status = typeof result?.status === "string" ? result.status : undefined
    if (job.kind === "delete") return
    if (status === "created" || status === "duplicate" || status === "updated") {
      if (typeof result?.qsoid === "number") this.idsFor(job.operationUuid).set(job.signature, result.qsoid)
      if (typeof result?.warning === "string") this.deps.log(`Club Log: ${job.signature}: ${result.warning}`)
      return
    }
    this.tellRejected(job, typeof result?.message === "string" ? result.message : status ?? "no answer")
  }

  private tellRejected(job: Post, message: string): void {
    const their = job.qso.their as Record<string, JSONValue> | undefined
    this.tell({ key: "rejected", call: job.call, theirCall: String(their?.call ?? ""), message })
  }

  /// Once per reason and station call, not per contact: Club Log refuses a
  /// callsign the token's account does not hold item by item, inside a 200,
  /// so an operation under the wrong call would otherwise raise a notice per
  /// contact.
  private tell(problem: Problem): void {
    const id = problem.key === "tokenRefused" ? problem.key : `${problem.key}:${problem.call}:${problem.message}`
    if (this.told.has(id)) return
    this.told.add(id)
    this.deps.tell(problem)
  }

  private drop(items: Job[]): void {
    const sent = new Set(items)
    this.queue = this.queue.filter((job) => !sent.has(job))
  }

  private backOff(): void {
    this.backoffMs = Math.min(MAX_BACKOFF_MS, this.backoffMs ? this.backoffMs * 2 : FIRST_BACKOFF_MS)
    this.pausedUntil = this.deps.now() + this.backoffMs
  }
}

function parse(body: string): Record<string, JSONValue> | undefined {
  try {
    const value = JSON.parse(body) as JSONValue
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, JSONValue>) : undefined
  } catch {
    return undefined
  }
}

/// The record of an ADIF file, without its header: what Club Log's `adif`
/// field takes.
///
/// Its bands are upper-cased. ADIF bands are case-insensitive, but Club Log
/// rejects `40m` ("Invalid or unsupported band") and takes `40M`, while the
/// exporter writes them as ADIF lists them, lower case.
export function recordOf(file: string): string {
  const end = file.search(/<eoh>/i)
  const record = (end >= 0 ? file.slice(end + 5) : file).trim()
  if (!/<eor>/i.test(record)) throw new Error("the exporter wrote no record")
  const tag = /<BAND(?:_RX)?:(\d+)(?::[^>]*)?>/gi
  let out = ""
  let from = 0
  for (let match = tag.exec(record); match; match = tag.exec(record)) {
    const start = match.index + match[0].length
    const stop = start + Number(match[1])
    out += record.slice(from, start) + record.slice(start, stop).toUpperCase()
    from = stop
    tag.lastIndex = stop
  }
  return out + record.slice(from)
}
