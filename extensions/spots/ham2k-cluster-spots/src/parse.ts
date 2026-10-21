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
// comment, the UTC time, and sometimes the spotter's grid or state.
//
// They all list past spots (`SH/DX`) alike too, one line each, dated in full:
//
//    14074.0  K2ZJ        21-Oct-2026 1741Z  FT8 -14dB 2640Hz             <EA4HOS-1>
//
// Anything else the node sends — prompts, announcements, talk, another
// command's reply — is not a spot and reads as nothing.

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

/// A line of `SH/DX`: frequency, call, date and time, comment, and the
/// spotter in angle brackets. A full comment runs into the bracket (AR-Cluster)
/// or is cut short of it (CC Cluster), so the spotter is what ends the line.
const LISTED = /^(\d+(?:\.\d+)?)\s+(\S+)\s+(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{4})Z(.*?)<([^<>\s]+)>$/

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

/// What a band mostly carries, for a frequency whose segment the band plan
/// names no mode for — the US phone segment above 7.2 MHz most of all, but
/// also 60 m, the 10 m beacon and satellite segments, and the edges of 6 m
/// and 2 m. A spot with no mode is one the Spots panel hides as soon as its
/// mode filter narrows to anything.
const USUAL_MODES: Record<string, string> = {
  "160m": "CW",
  "80m": "SSB",
  "60m": "SSB",
  "40m": "SSB",
  "30m": "CW",
  "20m": "SSB",
  "17m": "SSB",
  "15m": "SSB",
  "12m": "SSB",
  "10m": "SSB",
  "6m": "SSB",
  "4m": "SSB",
  "2m": "FM",
  "1.25m": "FM",
  "70cm": "FM",
}

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

/// The node programs this extension knows how to ask for everything.
export type NodeProgram = "AR-Cluster" | "DXSpider" | "CC Cluster"

/// Whether [text] is a node's command prompt to [call] — `KI2D de K3LR
/// 21-Oct 1842Z arc6>` — the line every login and every command's reply ends
/// on. Shown to the session's own call: a line that merely looks like one,
/// quoted in talk, names someone else.
export function isPromptFor(text: string, call: string): boolean {
  const line = text.replace(/[\x00-\x1f\x7f]/g, " ").trim()
  return line.toUpperCase().startsWith(`${call.toUpperCase()} DE `) && line.endsWith(">")
}

/// The program behind a node, from its prompt: `arc6>`, `dxspider >`,
/// `CCC >`.
export function nodeProgramFromPrompt(prompt: string): NodeProgram | undefined {
  const line = prompt.replace(/[\x00-\x1f\x7f]/g, " ").trim()
  if (/\barc\d*\s*>$/i.test(line)) return "AR-Cluster"
  if (/\bdxspider\s*>$/i.test(line)) return "DXSpider"
  if (/\bCCC\s*>$/.test(line)) return "CC Cluster"
  return undefined
}

/// [text], one line from the node, as a spot, or undefined when it is not
/// one. [arrivedAt] is when the app received it, which dates the spot's own
/// `HHMMZ`.
export function parseSpotLine(text: string, arrivedAt: number): Spot | undefined {
  // Nodes ring the bell on a spot of interest, and a line can arrive with
  // its carriage return still on.
  const line = text.replace(/[\x00-\x1f\x7f]/g, " ").trim()

  const announced = DX_DE.exec(line)
  if (announced) {
    const [, spotter, freqText, callText, commentText, hhmm, trailing] = announced
    return spotOf({ spotter, freqText, callText, commentText, timeInMillis: spotTime(hhmm, arrivedAt), location: trailing.trim() })
  }

  const listed = LISTED.exec(line)
  if (listed) {
    const [, freqText, callText, day, month, year, hhmm, commentText, spotter] = listed
    const monthIndex = MONTHS.indexOf(month.toUpperCase())
    if (monthIndex < 0) return undefined
    const timeInMillis = Date.UTC(Number(year), monthIndex, Number(day), Number(hhmm.slice(0, 2)), Number(hhmm.slice(2, 4)))
    return spotOf({ spotter, freqText, callText, commentText, timeInMillis })
  }

  return undefined
}

function spotOf({ spotter, freqText, callText, commentText, timeInMillis, location }: {
  spotter: string
  freqText: string
  callText: string
  commentText: string
  timeInMillis: number
  location?: string
}): Spot | undefined {
  const freq = Number(freqText)
  // A call the app itself would take, as a node relays the call field
  // unchecked (`TEST`, `?`, a frequency typed in the wrong place).
  const call = parseCallsign(callText.toUpperCase()).call
  if (!(freq > 0) || !call || Number.isNaN(timeInMillis)) return undefined

  const comment = commentText.trim()
  const band = bandForFrequency(freq)
  // The band plan only where the comment names no mode: a spot reading
  // `FT8` on 14.080 is FT8 whatever the plan says belongs there. The plan
  // read is the spotted station's where it has one of its own; where it has
  // nothing to say, the band's usual mode. Above the bands that have one
  // (microwaves), the spot has no mode.
  const mode =
    modeFromComment(comment) ??
    (modeForFrequency(freq, { entityPrefix: entityPrefixForCall(call) }) || undefined) ??
    (band ? USUAL_MODES[band] : undefined)

  const sourceInfo: Record<string, JSONValue> = { spotter: spotter.toUpperCase() }
  if (comment) sourceInfo.comments = comment
  // A grid (DXSpider) or a US state (AR-Cluster, CC Cluster), depending on
  // the node; kept as the node wrote it. A listed spot has neither.
  if (location) sourceInfo.spotterLocation = location

  return {
    their: { call },
    freq,
    band: band && band !== "other" ? band : undefined,
    mode,
    spot: {
      timeInMillis,
      source: SPOT_SOURCE,
      label: comment || `de ${spotter.toUpperCase()}`,
      sourceInfo,
    },
  }
}
