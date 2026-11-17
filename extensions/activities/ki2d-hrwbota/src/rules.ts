// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// HRWBOTA's scoring, as the tracker (tracker.hrwbota.com) keeps it, so a
// chaser's running score here agrees with the leaderboard:
//
// - A contact with a host is worth power points × mode points. Power: QRO 1,
//   about 100 W 2, QRP 4, from the power the host logged for the contact,
//   else from their card (all a chaser can know). Mode: CW 2, voice and digital
//   1. DMR, AllStar, D-STAR and the other linked voice networks are a flat 2.
//   A wildcard guest's card carries its own flat value (6.52), which replaces
//   the whole calculation.
// - Each host counts once per band and mode group (CW, voice, digital), at
//   the best value worked; the linked networked voice modes once per host,
//   whatever the band.
// - Only contacts inside the event's hours count.
// - A prefixed or suffixed call (VE3/K2ABC/P) is the base call.

export type PowerClass = "qro" | "100w" | "qrp"
export type ModeGroup = "cw" | "phone" | "digital" | "dmr"

const POWER_POINTS: Record<PowerClass, number> = { qro: 1, "100w": 2, qrp: 4 }
const MODE_POINTS: Record<ModeGroup, number> = { cw: 2, phone: 1, digital: 1, dmr: 1 }

export function qsoPoints(powerClass: PowerClass, modeGroup: ModeGroup, pointsOverride: number | null): number {
  if (pointsOverride !== null) return pointsOverride
  if (modeGroup === "dmr") return POWER_POINTS["100w"] * MODE_POINTS.dmr
  return POWER_POINTS[powerClass] * MODE_POINTS[modeGroup]
}

const PHONE = ["SSB", "USB", "LSB", "AM", "FM", "PHONE", "FREEDV", "DIGITALVOICE"]
const NETWORKED = ["DMR", "ALLSTAR", "DSTAR", "D-STAR", "C4FM", "FUSION", "M17"]

/// Unknown modes count as digital, as the tracker counts them.
export function modeGroupFor(mode: string): ModeGroup {
  const m = mode.trim().toUpperCase()
  if (m === "CW") return "cw"
  if (PHONE.includes(m)) return "phone"
  if (NETWORKED.includes(m)) return "dmr"
  return "digital"
}

/// Hundredths, so sums of 6.52 don't show float noise.
export function roundPoints(points: number): number {
  return Math.round(points * 100) / 100
}

const CALL = /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,4}[A-Z]$/

const suffixLength = (call: string) => call.length - 1 - call.search(/[0-9][A-Z]*$/)

/// "VE3/K2ABC/P" → "K2ABC". Of the slash-separated parts that look like calls,
/// the one with the longest suffix wins, then the longest, so a DX prefix that
/// happens to look like a call ("VP2E/W1AW") loses to the call.
export function baseCall(call: string): string | null {
  const parts = call.trim().toUpperCase().split("/").filter((p) => CALL.test(p))
  if (parts.length === 0) return null
  return parts.reduce((best, p) => {
    const bySuffix = suffixLength(p) - suffixLength(best)
    return bySuffix > 0 || (bySuffix === 0 && p.length > best.length) ? p : best
  })
}

/// The power class a contact's transmitter power falls in, as the tracker
/// reads it: QRP is 5 W or less (10 W on voice), QRO over 100 W. Undefined
/// when the log doesn't say, so the host's card decides.
export function powerClassForWatts(watts: number | undefined, modeGroup: ModeGroup): PowerClass | undefined {
  if (watts === undefined || !Number.isFinite(watts) || watts <= 0) return undefined
  if (watts <= (modeGroup === "phone" ? 10 : 5)) return "qrp"
  if (watts <= 100) return "100w"
  return "qro"
}

/// A contact's transmitter power in watts, as the logger keeps it (`power`, a
/// number or the text typed, like "5" or "100W"), read the way the tracker
/// reads TX_PWR. Undefined when it says nothing readable.
export function wattsOf(power: unknown): number | undefined {
  if (typeof power === "number") return Number.isFinite(power) && power > 0 ? power : undefined
  if (typeof power !== "string") return undefined
  const match = /^\s*(\d+(?:\.\d+)?)\s*W?\s*$/i.exec(power)
  const watts = match ? Number(match[1]) : 0
  return watts > 0 ? watts : undefined
}
