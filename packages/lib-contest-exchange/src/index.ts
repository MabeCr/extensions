// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// A contest's received exchange at save time, from `processQsoBeforeSave`.
//
// A contest suggests what the other station is likely to send — a zone from
// the country file, a name from the callsign lookup — and the entry field
// writes it onto the contest ref when the operator logs with it showing. A
// call list, a call stack or a contact logged before the lookup landed never
// shows the field, so the save hook guesses again and STAMPS the guess onto
// the ref as data of record, so the log, the scorer and the export agree
// (HaLo's docs/design/contests.md, M4). It also projects the exchange into
// `their.exchange`, which the QSO row and a plain ADIF export read.
//
// The guesses are each contest's own. What is the same everywhere, and easy to
// get wrong, is the bookkeeping around them:
//
//   * PRESENCE, not truthiness, says what the operator decided. The core writes
//     `field: ''` when the operator empties a field on purpose and leaves the
//     key off when it was never filled in, so a present key — blank or not —
//     is a decision, and guessing over it would put back what they removed.
//   * Only a value is stamped. A `''` stamped for a guess that came up empty
//     would read back on the next save as "the operator emptied this", and
//     the field would never be guessed again.
//   * A deliberate blank still projects, as `their.exchange: ''`, so clearing
//     an exchange on an edit clears the QSO row's column too.

import type { JSONValue } from "@ham2k/extension-sdk"

/// One part of a received exchange, as the contest's own ref stores it.
export interface ExchangeField {
  /// What a value the operator decided — typed, or emptied — reads as in the
  /// exchange: normalized, or `''` for nothing.
  read: (value: JSONValue | undefined) => string
  /// The guess for a part the operator has not decided, or `''` for none.
  /// Called only then. Left out, the part is never guessed.
  guess?: () => string
  /// `false`: the part is read into the exchange but never written back onto
  /// the ref — a serial, say, which the ref already holds as typed.
  stamp?: false
}

/// The `processQsoBeforeSave` patch for a received exchange of [fields], kept
/// on the contest ref [ref] of [type] — the QSO's own ref, which the caller
/// finds, since some contests answer for more than one type — and projected by
/// [project], which joins the parts' values the way the exchange is sent and
/// gives `''` when they are all empty.
///
/// Each part is read from the ref when the operator decided it, and guessed
/// otherwise. The parts with a value are stamped onto the ref (normalized, if
/// decided); the whole is projected into `their.exchange`. Null when there is
/// nothing to say: nothing decided and nothing guessed.
export function stampedExchange<K extends string>(
  type: string,
  ref: Record<string, JSONValue> | undefined,
  fields: Record<K, ExchangeField>,
  project: (values: Record<K, string>) => string,
): Record<string, JSONValue> | null {
  const values = {} as Record<K, string>
  const stamped: Record<string, JSONValue> = {}
  let decided = false

  for (const key of Object.keys(fields) as K[]) {
    const field = fields[key]
    const isDecided = ref !== undefined && key in ref
    decided ||= isDecided
    const value = isDecided ? field.read(ref[key]) : (field.guess?.() ?? '')
    values[key] = value
    if (value && field.stamp !== false) stamped[key] = value
  }

  const exchange = project(values)
  if (!exchange) return decided ? { their: { exchange: '' } } : null
  return {
    ...(Object.keys(stamped).length > 0 ? { refs: [{ type, ...stamped }] } : {}),
    their: { exchange },
  }
}
