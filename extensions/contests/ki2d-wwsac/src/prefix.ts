// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The WWSAC multiplier: "Each callsign prefix worked. (Same multipliers as CQ
// WPX.)" (rules 4).
//
// A COPY of `wpxPrefix` in `ham2k-cqwpx/src/scorer.ts`: a published extension
// may not reach into another one's source. Keep the two the same — a fix to
// one is a fix to both — or move them into a shared package the day a third
// contest needs it.

import { parseCallsign } from "@ham2k/lib-callsigns"
import type { JSONValue } from "@ham2k/extension-sdk"

import { str } from "./exchange.ts"

/// The WPX prefix of a callsign: the letter/numeral combination that forms
/// the first part of the call.
///
/// `parseCallsign` resolves the hard parts already — a portable designator wins
/// over the home prefix (N8BJQ/W4 → W4, W8/GW4BLE → W8), while /P, /M and /QRP
/// are not prefixes at all (LZ2ITU/P → LZ2). Two rules it does not cover, both
/// named explicitly in the WPX rules:
///
///   * A special-event call that is letters-then-digits IS its own prefix
///     (HG19, OE25, LY1000).
///   * Anything with no number gets a zero after its first two letters —
///     PA/N8BJQ → PA0, XEFTJW → XE0.
export function wpxPrefix(call: string): string {
  const trimmed = call.trim().toUpperCase()
  if (!trimmed) return ''

  // Only for an unmodified call: in `N8BJQ/HG19` the designator is what counts,
  // and `parseCallsign` is what knows which side of the slash that is.
  if (!trimmed.includes('/') && /^[A-Z]+[0-9]+$/.test(trimmed)) return trimmed

  const parsed = parseCallsign(trimmed)
  const candidate = str(parsed.prefix as JSONValue | undefined) || trimmed.replace(/[^A-Z0-9]/g, '')
  if (!candidate) return ''
  return /[0-9]/.test(candidate) ? candidate : `${candidate.slice(0, 2)}0`
}
