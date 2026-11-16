// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The ARRL and RAC sections as a checklist, the same in every contest that
// takes a section as its exchange: ARRL Sweepstakes, ARRL Field Day and
// Winter Field Day.
//
// The sections themselves stay each contest's own data — its exchange
// validates against them, and its tests hold them to SECTION_ROWS — but how
// they are shown is one thing, here.
//
// The 85 sections of the ARRL's contest list (contests.arrl.org/contestmultipliers.php):
// 71 US and 14 Canadian. Yukon, the Northwest Territories and Nunavut are one
// section, `TER`; RAC's newer `YT` is not on the contest list.

import type { HookContext } from "@ham2k/extension-sdk"
import { fmtInteger } from "@ham2k/lib-format-tools"

import { tFor } from "./i18n.ts"

/// The checklist's rows: the US call areas in the order a Sweepstakes check
/// sheet lists them, then Canada, each row's sections in alphabetical order.
export const SECTION_ROWS: readonly (readonly [string, readonly string[]])[] = [
  ['W1', ['CT', 'EMA', 'ME', 'NH', 'RI', 'VT', 'WMA']],
  ['W2', ['ENY', 'NLI', 'NNJ', 'NNY', 'SNJ', 'WNY']],
  ['W3', ['DE', 'EPA', 'MDC', 'WPA']],
  ['W4', ['AL', 'GA', 'KY', 'NC', 'NFL', 'PR', 'SC', 'SFL', 'TN', 'VA', 'VI', 'WCF']],
  ['W5', ['AR', 'LA', 'MS', 'NM', 'NTX', 'OK', 'STX', 'WTX']],
  ['W6', ['EB', 'LAX', 'ORG', 'PAC', 'SB', 'SCV', 'SDG', 'SF', 'SJV', 'SV']],
  ['W7', ['AK', 'AZ', 'EWA', 'ID', 'MT', 'NV', 'OR', 'UT', 'WWA', 'WY']],
  ['W8', ['MI', 'OH', 'WV']],
  ['W9', ['IL', 'IN', 'WI']],
  ['W0', ['CO', 'IA', 'KS', 'MN', 'MO', 'ND', 'NE', 'SD']],
  ['VE', ['AB', 'BC', 'GH', 'MB', 'NB', 'NL', 'NS', 'ONE', 'ONN', 'ONS', 'PE', 'QC', 'SK', 'TER']],
]

const ALL_CODES = new Set(SECTION_ROWS.flatMap(([, codes]) => codes))

/// Every section as a checklist, a row per call area, those [worked] struck
/// through — the core's checklist convention (a summary with `grid: true`).
/// A heading counts them, or calls a full set a Clean Sweep.
///
/// A worked code that is not one of the 85 — Field Day's `DX` and `MX` — gets
/// a row of its own after Canada, so a contact counted in the score is never
/// missing from the list under it.
export function sectionsChecklist(worked: Iterable<string>, ctx: Pick<HookContext, 'locale'>): string {
  const t = tFor(ctx)
  const workedSet = new Set(worked)
  const count = [...workedSet].filter((code) => ALL_CODES.has(code)).length
  const heading = count === ALL_CODES.size
    ? t('cleanSweep', { total: fmtInteger(ALL_CODES.size) })
    : t('sectionsHeading', { worked: fmtInteger(count), total: fmtInteger(ALL_CODES.size) })
  const strike = (code: string) => (workedSet.has(code) ? `**~~${code}~~**` : code)
  const rows = SECTION_ROWS.map(([label, codes]) => `${label} ${codes.map(strike).join(' ')}`)
  const others = [...workedSet].filter((code) => !ALL_CODES.has(code)).sort()
  if (others.length > 0) rows.push(`${t('sectionsOther')} ${others.map(strike).join(' ')}`)
  return `### ${heading}\n\n${rows.join('\n')}`
}
