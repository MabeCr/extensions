// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
//
// Frequencies as the app's QSO list writes them: a kHz reading in three parts — whole MHz in bold,
// the thousands mark and kHz, then the decimal mark and Hz digits, smaller — so the map reads like
// the log beside it. Mirrors halo_core's `freqDisplayParts` and `hzDigitsNeeded`.

/** One reading's parts, each with the mark that leads it. */
export type FreqParts = { mhz: string; khz: string; hz?: string }

/** Rounded to the Hz first: splitting the kHz as a double can round a remainder up to 1000 Hz. */
const totalHz = (khz: number) => Math.round(khz * 1000)

export function freqParts(khz: number, hzDigits: number, marks: { group: string; decimal: string }): FreqParts {
  const hz = totalHz(khz), mhz = Math.floor(hz / 1_000_000), kilo = Math.floor(hz / 1000) % 1000
  const rest = hzDigits > 0 ? `${marks.decimal}${String(hz % 1000).padStart(3, '0').slice(0, hzDigits)}` : undefined
  // Below 1 MHz there is no thousands group: `0,472` is not a reading anyone writes.
  return mhz > 0 ? { mhz: String(mhz), khz: `${marks.group}${String(kilo).padStart(3, '0')}`, hz: rest } : { mhz: String(kilo), khz: '', hz: rest }
}

/** How many Hz digits show every one of [khzs] exactly: 0 when all land on a whole kHz. */
export function hzDigitsNeeded(khzs: number[]): number {
  let most = 0
  for (const khz of khzs) {
    const digits = String(totalHz(khz) % 1000).padStart(3, '0').replace(/0+$/, '').length
    most = Math.max(most, digits)
  }
  return most
}
