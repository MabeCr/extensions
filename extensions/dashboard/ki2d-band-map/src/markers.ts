// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
//
// The places on each band worth marking — calling frequencies, the digital watering holes, QRP and
// QRS, emergency nets — from the markers in https://ham2k.com/data/band-plans.json. 21055's label
// there says QRP under the QRS turtle; it is QRS here.

/** A frequency worth marking on the band: an emoji at the map's edge, its label on hover. */
export type BandMarker = {
  khz: number; icon: string; label: string
  /** A boundary, such as a license class's, rather than a place: drawn as a solid line. */
  type?: 'edge'
  /** Only for stations in these IARU regions. */
  regions?: number[]
  /** Only for stations in these DXCC entities, by prefix. */
  entities?: string[]
}

export const bandMarkers: Record<string, BandMarker[]> = {
  '160m': [
    { khz: 1810, icon: '🕯️', label: 'CW QRP' },
    { khz: 1836.6, icon: '💻', label: 'WSPR' },
    { khz: 1840, icon: '💻', label: 'FT8' },
    { khz: 1910, icon: '🕯️', label: 'SSB QRP' },
    { khz: 2000, icon: '🔔', label: 'Beacons' },
  ],
  '80m': [
    { khz: 3555, icon: '🐢', label: 'CW QRS' },
    { khz: 3560, icon: '🕯️', label: 'CW QRP' },
    { khz: 3568.6, icon: '💻', label: 'WSPR' },
    { khz: 3573, icon: '💻', label: 'FT8' },
    { khz: 3735, icon: '🖼️', label: 'SSTV' },
    { khz: 3750, icon: '🚨', label: 'Emergency', regions: [2] },
    { khz: 3800, icon: '⛔️', label: 'US Extra/General', type: 'edge', entities: ['K'] },
    { khz: 3845, icon: '🖼️', label: 'SSTV' },
    { khz: 3985, icon: '🚨', label: 'Emergency', regions: [2] },
  ],
  '60m': [
    { khz: 5357, icon: '💻', label: 'FT8' },
  ],
  '40m': [
    { khz: 7030, icon: '🕯️', label: 'CW QRP' },
    { khz: 7047.5, icon: '💻', label: 'FT4' },
    { khz: 7074, icon: '💻', label: 'FT8' },
    { khz: 7110, icon: '🚨', label: 'Emergency', regions: [1] },
    { khz: 7171, icon: '🖼️', label: 'SSTV' },
    { khz: 7200, icon: '🐉', label: 'Here be dragons…', regions: [2] },
    { khz: 7240, icon: '🚨', label: 'Emergency', regions: [2] },
    { khz: 7285, icon: '🕯️', label: 'SSB QRP' },
    { khz: 7285, icon: '🚨', label: 'Emergency', regions: [2] },
    { khz: 7290, icon: '🗣️', label: 'AM' },
  ],
  '30m': [
    { khz: 10116, icon: '🕯️', label: 'CW QRP' },
    { khz: 10136, icon: '💻', label: 'FT8' },
    { khz: 10140, icon: '💻', label: 'FT4' },
  ],
  '20m': [
    { khz: 14055, icon: '🐢', label: 'CW QRS' },
    { khz: 14060, icon: '🕯️', label: 'CW QRP' },
    { khz: 14074, icon: '💻', label: 'FT8' },
    { khz: 14080, icon: '💻', label: 'FT4' },
    { khz: 14100, icon: '🔔', label: 'Beacons' },
    { khz: 14225, icon: '⛔️', label: 'US Extra/General', type: 'edge', entities: ['K'] },
    { khz: 14230, icon: '🖼️', label: 'SSTV' },
    { khz: 14285, icon: '🕯️', label: 'SSB QRP' },
    { khz: 14300, icon: '🚨', label: 'Emergency' },
  ],
  '17m': [
    { khz: 18086, icon: '🕯️', label: 'CW QRP' },
    { khz: 18100, icon: '💻', label: 'FT8' },
    { khz: 18104, icon: '💻', label: 'FT4' },
    { khz: 18110, icon: '🔔', label: 'Beacons' },
    { khz: 18130, icon: '🕯️', label: 'SSB QRP' },
    { khz: 18160, icon: '🚨', label: 'Emergency' },
  ],
  '15m': [
    { khz: 21055, icon: '🐢', label: 'CW QRS' },
    { khz: 21060, icon: '🕯️', label: 'CW QRP' },
    { khz: 21074, icon: '💻', label: 'FT8' },
    { khz: 21140, icon: '💻', label: 'FT4' },
    { khz: 21150, icon: '🔔', label: 'Beacons' },
    { khz: 21275, icon: '⛔️', label: 'US Extra/General', type: 'edge', entities: ['K'] },
    { khz: 21285, icon: '🕯️', label: 'SSB QRP' },
    { khz: 21340, icon: '🖼️', label: 'SSTV' },
    { khz: 21360, icon: '🚨', label: 'Emergency' },
  ],
  '12m': [
    { khz: 24906, icon: '🕯️', label: 'CW QRP' },
    { khz: 24915, icon: '💻', label: 'FT8' },
    { khz: 24919, icon: '💻', label: 'FT4' },
    { khz: 24930, icon: '🔔', label: 'Beacons' },
    { khz: 24950, icon: '🕯️', label: 'SSB QRP' },
  ],
  '10m': [
    { khz: 28055, icon: '🐢', label: 'CW QRS' },
    { khz: 28060, icon: '🕯️', label: 'CW QRP' },
    { khz: 28074, icon: '💻', label: 'FT8' },
    { khz: 28180, icon: '💻', label: 'FT4' },
    { khz: 28360, icon: '🕯️', label: 'SSB QRP' },
    { khz: 28400, icon: '⛔️', label: 'US Extra/General', type: 'edge', entities: ['K'] },
    { khz: 28680, icon: '🖼️', label: 'SSTV' },
    { khz: 29600, icon: '🗣️', label: 'FM Simplex Calling' },
  ],
  '6m': [
    { khz: 50125, icon: '🗣️', label: 'SSB Calling' },
    { khz: 50313, icon: '💻', label: 'FT8' },
    { khz: 50318, icon: '💻', label: 'FT4' },
    { khz: 50350, icon: '🖼️', label: 'SSTV' },
    { khz: 50525, icon: '🗣️', label: 'FM Simplex Calling Primary' },
    { khz: 50540, icon: '🗣️', label: 'FM Simplex Calling Secondary' },
  ],
  '2m': [
    { khz: 146520, icon: '🗣️', label: 'FM Simplex Calling', entities: ['K'] },
  ],
}

/**
 * The markers for a station in `region` and the entity `entity` (its prefix): those for everyone,
 * and those for its region or entity. One whose station is unknown sees them all.
 */
export function markersFor(band: string, station: { region?: number; entity?: string }): BandMarker[] {
  return (bandMarkers[band] ?? []).filter(m =>
    (!m.regions || station.region == null || m.regions.includes(station.region)) &&
    (!m.entities || station.entity == null || m.entities.includes(station.entity)))
}

/** The labels in Spanish, where they say more than a mode's name. */
export const markerLabelsEs: Record<string, string> = {
  Beacons: 'Balizas', Emergency: 'Emergencias', 'Here be dragons…': 'Aquí hay dragones…',
  'SSB Calling': 'Llamada en SSB', 'FM Simplex Calling': 'Llamada en FM símplex',
  'FM Simplex Calling Primary': 'Llamada en FM símplex, principal', 'FM Simplex Calling Secondary': 'Llamada en FM símplex, secundaria',
}
