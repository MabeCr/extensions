// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// HRWBOTA's exchange. A host sends a serial number (and the POTA exchange
// when activating, which the POTA extension keeps); a listener sends how
// many soldering irons they have, their favourite one's brand, and their
// state.
//
// The logging fields keep each part on the contact's own `hrwbota` ref:
// `ourSerial` and, from the listener, `theirIrons` and `theirBrand` in a
// host's log; `theirSerial` in a listener's. A listener's own irons, brand
// and state are the operation's: they're asked once, in the activity's setup.
// The state a host copies goes in the logger's own State field.

import type { JSONValue } from "@ham2k/extension-sdk"

type Data = Record<string, JSONValue>

const text = (value: JSONValue | undefined): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : typeof value === "number" ? String(value) : ""

/// The first ref of `type` on a contact or an operation.
export function refOf(container: Data | undefined, type: string): Data | undefined {
  const refs = container?.refs
  if (!Array.isArray(refs)) return undefined
  return refs.find((ref): ref is Data => !!ref && typeof ref === "object" && !Array.isArray(ref) && (ref as Data).type === type)
}

/// A serial as digits, without leading zeros; "" when there is none.
export function serialText(value: JSONValue | undefined): string {
  const digits = text(value)
  return /^\d{1,6}$/.test(digits) ? String(Number(digits)) : ""
}

/// The serial a host sent on this contact, if any.
export function sentSerial(qso: Data, type: string): number | undefined {
  const serial = serialText(refOf(qso, type)?.ourSerial)
  return serial ? Number(serial) : undefined
}

/// The listener's irons and brand as a host copied them: "3 HAKKO".
export function listenerExchange(qso: Data, type: string): string {
  const ref = refOf(qso, type)
  return [text(ref?.theirIrons), text(ref?.theirBrand).toUpperCase()].filter((part) => part).join(" ")
}

/// How many soldering irons the listener said they have, as a host copied
/// it: the leading number of the exchange the tracker gets, read by the
/// tracker's rule, so both count the same.
export function listenerIrons(qso: Data, type: string): number | undefined {
  const count = listenerExchange(qso, type).match(/^(\d{1,4})(?=\s|$)/)?.[1]
  return count === undefined ? undefined : Number(count)
}

/// Whether a host's logging fields have said anything about the listener's
/// exchange, blank included, so clearing them clears the row too.
export function hasListenerExchange(qso: Data, type: string): boolean {
  const ref = refOf(qso, type)
  return !!ref && ("theirIrons" in ref || "theirBrand" in ref)
}

/// What a listener sends, from the activity's setup: "3 HAKKO NY".
export function ownExchange(opRef: Data | undefined): string {
  return [text(opRef?.irons), text(opRef?.brand).toUpperCase(), text(opRef?.state).toUpperCase()].filter((part) => part).join(" ")
}
