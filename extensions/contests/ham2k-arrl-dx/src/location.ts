// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The Cabrillo LOCATION line. "For USA and Canada stations LOCATION must be
// the ARRL section abbreviation. For foreign stations LOCATION must be 'DX'.
// This information is required for IARU-HF and for all ARRL and CQ contests"
// (Cabrillo v3, wwrof.org/cabrillo/cabrillo-v3-header/).
//
// The section codes are DUPLICATED from `arrl-ss`, on purpose: each extension
// stands alone. Checked against the ARRL's list of the 85 W/VE sections
// (contests.arrl.org/contestmultipliers.php).
//
// Separate from index.ts so these can be unit-tested: index.ts calls
// `defineExtension` at import time.

import type { JSONValue } from "@ham2k/extension-sdk"
import { annotateCallAgainstCountryFile } from "@ham2k/extension-sdk"

/// The 71 ARRL and 14 RAC sections.
const SECTIONS = new Set([
  'AK', 'AL', 'AR', 'AZ', 'CO', 'CT', 'DE', 'EB', 'EMA', 'ENY', 'EPA', 'EWA', 'GA', 'IA', 'ID', 'IL', 'IN', 'KS',
  'KY', 'LA', 'LAX', 'MDC', 'ME', 'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND', 'NE', 'NFL', 'NH', 'NLI', 'NM', 'NNJ',
  'NNY', 'NTX', 'NV', 'OH', 'OK', 'OR', 'ORG', 'PAC', 'PR', 'RI', 'SB', 'SC', 'SCV', 'SD', 'SDG', 'SF', 'SFL', 'SJV',
  'SNJ', 'STX', 'SV', 'TN', 'UT', 'VA', 'VI', 'VT', 'WCF', 'WI', 'WMA', 'WNY', 'WPA', 'WTX', 'WV', 'WWA', 'WY',
  'AB', 'BC', 'GH', 'MB', 'NB', 'NL', 'NS', 'ONE', 'ONN', 'ONS', 'PE', 'QC', 'SK', 'TER',
])

/// A section as typed, if it is one of the 85; '' otherwise.
export function normalizeSection(value: JSONValue | undefined): string {
  const code = (typeof value === 'string' ? value : '').trim().toUpperCase()
  return SECTIONS.has(code) ? code : ''
}

/// Whether [call] operates from the USA or Canada, possessions included:
/// Alaska, Hawaii, Puerto Rico, the Virgin Islands and the Pacific
/// possessions all have sections — even where a contest counts them as DX.
/// A call the country file cannot place is not assumed foreign.
export function inUsOrCanada(call: string): boolean {
  const entity = String(annotateCallAgainstCountryFile(call).entityPrefix ?? '')
  return !entity || entity === 'K' || entity === 'VE' || /^K[HLP]/.test(entity)
}

/// LOCATION for our station: 'DX' outside the USA and Canada, else the
/// section set at setup. One that isn't among the 85 is written as typed, so
/// the log checker names the mistake instead of finding the line missing;
/// '' only when none was set.
export function cabrilloLocation(call: string, ref: Record<string, JSONValue> | undefined): string {
  if (!call) return ''
  if (!inUsOrCanada(call)) return 'DX'
  return normalizeSection(ref?.section) || (typeof ref?.section === 'string' ? ref.section.replace(/\s+/g, '').toUpperCase() : '')
}
