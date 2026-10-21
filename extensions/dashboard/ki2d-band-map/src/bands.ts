// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0

/** Each band's edges in kHz, as the US allocates them: the map runs from one to the other. */
export const bandEdges: Record<string, [number, number]> = {
  '160m': [1800, 2000], '80m': [3500, 4000], '60m': [5330, 5410], '40m': [7000, 7300], '30m': [10100, 10150],
  '20m': [14000, 14350], '17m': [18068, 18168], '15m': [21000, 21450], '12m': [24890, 24990], '10m': [28000, 29700],
  '6m': [50000, 54000], '2m': [144000, 148000], '1.25m': [222000, 225000], '70cm': [420000, 450000],
}
export const bands = Object.keys(bandEdges)

export const bandForKHz = (khz: number | null | undefined) =>
  khz == null ? undefined : bands.find(band => khz >= bandEdges[band][0] && khz <= bandEdges[band][1])

/** SSB's sideband by the usual convention: lower below 10 MHz, but upper on 60 m. */
const sidebandFor = (khz: number) => (khz < 10000 && bandForKHz(khz) !== '60m' ? 'LSB' : 'USB')

const digital = ['FT8', 'FT4', 'JS8', 'PSK', 'PSK31', 'DATA', 'DIGI', 'OLIVIA', 'MFSK', 'JT65', 'JT9', 'Q65', 'FST4']

/**
 * The radio mode a spot's mode asks for, among the ones the radio offers: SSB on its usual
 * sideband, digital modes on upper sideband, the radio's data mode first.
 */
export function radioModeFor(mode: string | undefined, khz: number, offered: string[]): string | undefined {
  if (!mode) return undefined
  const wanted = mode === 'SSB' ? [sidebandFor(khz)]
    : ['USB', 'LSB', 'CW', 'AM', 'FM', 'RTTY'].includes(mode) ? [mode, ...(mode === 'RTTY' ? ['DATA-USB', 'USB'] : [])]
    : digital.includes(mode) ? ['DATA-USB', 'USB']
    : []
  return wanted.find(m => offered.includes(m))
}
