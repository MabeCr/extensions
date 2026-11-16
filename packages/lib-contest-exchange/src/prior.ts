// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// What a station sent us before, from the log, for a contest's prefill.
//
// Every contest that prefills an exchange ranks its sources the same way
// (HaLo's docs/design/contests.md, "Suggested values"):
//
//   1. what the station sent earlier in THIS operation — copied minutes ago;
//   2. the contest's call history file, where it keeps one (N1MM's);
//   3. what it sent in earlier runnings of the contest (`before` here), and
//      for a part that says where the station is, the lookup first: the
//      station can move, and the lookup is the fresher word on where it is;
//   4. the lookup, the country file and anything else.
//
// This reads 1 and 3. The ranking itself is each contest's, one `||` chain per
// part, since only the contest knows which parts say where the station is.

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"

type Fields = Record<string, JSONValue>

/// What [read] found for each part: the newest value in this operation
/// (`here`) and in earlier ones (`before`), `''` where none.
export interface PriorSent<K extends string> {
  here: Record<K, string>
  before: Record<K, string>
}

/// What [call] sent in contacts logged under any of [refTypes] — the
/// contest's own type, and any whose exchange is the same — read part by part
/// by [read] from the contact's ref of that type. A reader answers `''` for a
/// value that is no valid exchange, so an older, valid one is found instead.
///
/// [qso] is the contact being entered or edited; it is never its own history.
/// [limit] is how many of each side's newest contacts are read, ten unless a
/// part can sit further back than that (the host answers at most 50).
///
/// The split between `here` and `before` is the host's `operation` /
/// `excludeOperation` filters, taken on trust: a caller declares extension API
/// 2 or later, where every host has them. An older host ignores them and
/// would answer last year's exchange as this operation's.
///
/// An operation with no uuid has no `here`. A history that cannot be read
/// costs its answer and is reported, never thrown: a throw fails the whole
/// hook. When THIS operation's cannot be read, earlier ones are not offered
/// either — "could not ask" must not let last year's exchange answer over
/// what may have been copied minutes ago.
export async function priorSent<K extends string>(
  ctx: HookContext,
  args: {
    call: string
    operation: Fields
    qso?: Fields
    refTypes: string[]
    read: Record<K, (ref: Fields) => string>
    limit?: number
  },
): Promise<PriorSent<K>> {
  const keys = Object.keys(args.read) as K[]
  const none = () => Object.fromEntries(keys.map((key) => [key, ''])) as Record<K, string>
  const call = args.call.trim().toUpperCase()
  if (!call || !ctx.getHistoryForCall) return { here: none(), before: none() }

  const operationUuid = typeof args.operation.uuid === 'string' ? args.operation.uuid : ''
  const history = async (options: Record<string, JSONValue>): Promise<Fields[] | null> => {
    try {
      return (await ctx.getHistoryForCall!(call, { limit: args.limit ?? 10, refType: args.refTypes, ...options })) ?? []
    } catch (e) {
      console.warn(`[${args.refTypes[0]}] call history unavailable, no earlier exchange offered:`, e)
      return null
    }
  }
  const [here, before] = await Promise.all([
    operationUuid ? history({ operation: operationUuid }) : Promise.resolve([]),
    history(operationUuid ? { excludeOperation: operationUuid } : {}),
  ])
  if (here === null) return { here: none(), before: none() }

  const skip = typeof args.qso?.uuid === 'string' ? args.qso.uuid : undefined
  const newest = (qsos: Fields[]): Record<K, string> => {
    const found = none()
    for (const qso of qsos) {
      if (skip !== undefined && qso.uuid === skip) continue
      const refs = Array.isArray(qso.refs) ? (qso.refs as Fields[]) : []
      for (const type of args.refTypes) {
        const ref = refs.find((r) => r?.type === type)
        if (!ref) continue
        for (const key of keys) found[key] ||= args.read[key](ref)
      }
      if (keys.every((key) => found[key])) break
    }
    return found
  }
  return { here: newest(here), before: newest(before ?? []) }
}

/// Whether the save hook has any part of [keys] left to guess: one the
/// operator decided — typed, or emptied, so present on [ref] — is never
/// guessed, and needs no history read.
export function needsGuess(ref: Fields | undefined, keys: string[]): boolean {
  return keys.some((key) => ref === undefined || !(key in ref))
}
