// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0

// Match SolarPalette and index thresholds in the native solar_charts.dart.
// Status colors retain their meaning in both light and dark themes.
export const solarPalette = { good: '#2e9e4f', fair: '#c08316', poor: '#d04a34', severe: '#8b5cc7' }
/** The same meanings, deep enough to read on the teal theme's mid-tone surface. */
export const tealPalette = { good: '#14652f', fair: '#7a4d00', poor: '#a3261a', severe: '#5b2d99' }
export type SolarPalette = typeof solarPalette
export const solarFluxColor = (sfi: number, p: SolarPalette = solarPalette) => sfi < 100 ? p.poor : sfi < 150 ? p.fair : p.good
export const solarAColor = (a: number, p: SolarPalette = solarPalette) => a < 20 ? p.good : a < 30 ? p.fair : a < 100 ? p.poor : p.severe
export const solarKColor = (k: number, p: SolarPalette = solarPalette) => k <= 3 ? p.good : k < 5 ? p.fair : k < 7 ? p.poor : p.severe
