// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// One line off the cluster, read as a spot. Pure, so it tests without the
// kernel.
//
// Every node software in the network — DXSpider, AR-Cluster, CC Cluster —
// announces a spot as the same 80-column `DX de` line:
//
//   DX de W3LPL:     14025.0  JA1ABC       CW 599                         1234Z FN20
//   DX de KM3T-#:    14021.0  OH2BH        CW 17 dB 25 WPM CQ             1234Z
//
// spotter, frequency in kHz, the spotted call, up to 30 characters of
// comment, the UTC time, and sometimes the spotter's grid or state. Anything
// else the node sends — prompts, announcements, talk, a command's reply — is
// not a spot and reads as nothing.

import { entityPrefixForCall } from "@ham2k/extension-sdk"
import type { JSONValue, Spot } from "@ham2k/extension-sdk"
import { parseCallsign } from "@ham2k/lib-callsigns"
import { bandForFrequency, modeForFrequency } from "@ham2k/lib-operation-data"

/// What every spot from the cluster is stamped with. The operator's spot list
/// and anything derived from it carry this string, so it is not the package
/// key and does not follow it.
export const SPOT_SOURCE = "cluster"

/// The columns are a convention, not a contract: a long spotter call or a
/// microwave frequency pushes the next field over, and a full comment runs
/// straight into the time. So the fields are read by what they look like,
/// and the time is the LAST `HHMMZ` on the line, which a comment quoting
/// another time (`QSX 1830Z`) cannot take from it: the up to two fields a
/// node may add after the time (a grid, a state, both) are never one.
const DX_DE = /^DX de\s+([^\s:]+):?\s*(\d+(?:\.\d+)?)\s+(\S+)\s+(.*?)\s*(\d{4})Z((?:\s+(?!\S*\d{4}Z)\S+){0,2})\s*$/i

/// Modes a spotter names in a comment, as words. Kept to what is actually
/// written there, rather than every ADIF mode, because a short word like
/// `AM` or `FM` is safe only as a whole token and a longer list buys more
/// false matches than spots.
const COMMENT_MODES: Record<string, string> = {
  CW: "CW",
  SSB: "SSB",
  USB: "SSB",
  LSB: "SSB",
  AM: "AM",
  FM: "FM",
  RTTY: "RTTY",
  FT8: "FT8",
  FT4: "FT4",
  FT2: "FT2",
  JT65: "JT65",
  JT9: "JT9",
  JS8: "JS8",
  Q65: "Q65",
  MSK144: "MSK144",
  FST4: "FST4",
  PSK31: "PSK31",
  PSK63: "PSK63",
  PSK: "PSK",
  OLIVIA: "OLIVIA",
  MFSK: "MFSK",
  SSTV: "SSTV",
  C4FM: "C4FM",
  DMR: "DMR",
  DSTAR: "DSTAR",
  FREEDV: "FREEDV",
}

/// The mode a comment names, its first one: a skimmer leads with it
/// (`CW 17 dB 25 WPM CQ`, `FT8 -12 dB 1234 Hz`), and a person who names one
/// usually does too.
export function modeFromComment(comment: string): string | undefined {
  for (const word of comment.toUpperCase().split(/[^A-Z0-9]+/)) {
    const mode = COMMENT_MODES[word]
    if (mode) return mode
  }
  return undefined
}

/// The `HHMM` a spot carries, as a moment: on the UTC day the line arrived,
/// or the day before for a spot from just before midnight read just after
/// it. A node's clock that runs a few minutes ahead of the app's is still
/// today, not yesterday.
export function spotTime(hhmm: string, arrivedAt: number): number {
  const hours = Number(hhmm.slice(0, 2)), minutes = Number(hhmm.slice(2, 4))
  if (hours > 23 || minutes > 59) return arrivedAt
  const day = new Date(arrivedAt)
  const time = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hours, minutes)
  return time - arrivedAt > 30 * 60 * 1000 ? time - 24 * 60 * 60 * 1000 : time
}

/// [text], one line from the node, as a spot, or undefined when it is not
/// one. [arrivedAt] is when the app received it, which dates the spot's own
/// `HHMMZ`.
export function parseSpotLine(text: string, arrivedAt: number): Spot | undefined {
  // Nodes ring the bell on a spot of interest, and a line can arrive with
  // its carriage return still on.
  const line = text.replace(/[\x00-\x1f\x7f]/g, " ").trim()
  const match = DX_DE.exec(line)
  if (!match) return undefined
  const [, spotter, freqText, callText, commentText, hhmm, trailing] = match

  const freq = Number(freqText)
  // A call the app itself would take, as a node relays the call field
  // unchecked (`TEST`, `?`, a frequency typed in the wrong place).
  const call = parseCallsign(callText.toUpperCase()).call
  if (!(freq > 0) || !call) return undefined

  const comment = commentText.trim()
  const band = bandForFrequency(freq)
  // The band plan only where the comment names no mode: a spot reading
  // `FT8` on 14.080 is FT8 whatever the plan says belongs there. Without
  // either, the spot has no mode, as the band plan says nothing above 10 GHz.
  // The plan read is the spotted station's where it has one of its own.
  const mode = modeFromComment(comment) ?? (modeForFrequency(freq, { entityPrefix: entityPrefixForCall(call) }) || undefined)

  const sourceInfo: Record<string, JSONValue> = { spotter: spotter.toUpperCase() }
  if (comment) sourceInfo.comments = comment
  // A grid (DXSpider) or a US state (AR-Cluster, CC Cluster), depending on
  // the node; kept as the node wrote it.
  const extra = trailing.trim()
  if (extra) sourceInfo.spotterLocation = extra

  return {
    their: { call },
    freq,
    band: band && band !== "other" ? band : undefined,
    mode,
    spot: {
      timeInMillis: spotTime(hhmm, arrivedAt),
      source: SPOT_SOURCE,
      label: comment || `de ${spotter.toUpperCase()}`,
      sourceInfo,
    },
  }
}
