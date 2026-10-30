// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The themes a dashboard panel offers in its settings. Automatic draws with the
// app's colors; Light and Dark are fixed schemes, so one placement can differ
// from the app's brightness; Teal is KI2D's Radio Panel's face. One table, so
// every panel that offers Teal means the same teal.

import type { JSONValue, PanelEnvironment, SettingsField } from '@ham2k/extension-sdk'

export const PANEL_THEMES = ['auto', 'light', 'dark', 'teal'] as const
export type PanelTheme = typeof PANEL_THEMES[number]
export type PanelColors = PanelEnvironment['colors']

// Light and dark are Material 3 schemes from the app's teal (#006783). Teal is the app's teal,
// lightened and muted, with black ink, and a dark teal accent that is also its primary.
const palettes: Record<Exclude<PanelTheme, 'auto'>, PanelColors> = {
  light: { surface: '#f5fafc', surfaceContainer: '#e9eff1', onSurface: '#171c1f', onSurfaceVariant: '#40484c', accent: '#006783', primary: '#006783', onPrimary: '#ffffff',
    secondary: '#4c626a', outline: '#70787d', outlineVariant: '#c0c8cc', error: '#ba1a1a', onError: '#ffffff' },
  dark: { surface: '#0f1416', surfaceContainer: '#1b2023', onSurface: '#dee3e6', onSurfaceVariant: '#c0c8cc', accent: '#86d1ec', primary: '#86d1ec', onPrimary: '#003545',
    secondary: '#b3cad3', outline: '#8a9296', outlineVariant: '#40484c', error: '#ffb4ab', onError: '#690005' },
  teal: { surface: '#a9c4cb', surfaceContainer: '#8faeb7', onSurface: '#000000', onSurfaceVariant: '#1f1f1f', accent: '#00384a', primary: '#00384a', onPrimary: '#a9c4cb',
    secondary: '#000000', outline: '#40575e', outlineVariant: '#7f9ea7', error: '#9c0f05', onError: '#ffffff' },
}

const labels = {
  en: { theme: 'Theme', themes: { auto: 'Automatic', light: 'Light', dark: 'Dark', teal: 'Teal' } },
  es: { theme: 'Tema', themes: { auto: 'Automático', light: 'Claro', dark: 'Oscuro', teal: 'Verde azulado' } },
}

/** A placement's saved theme; unset or unknown, as in one saved before panels had themes, follows the app. */
export function panelTheme(config: Record<string, JSONValue> | undefined): PanelTheme {
  return PANEL_THEMES.includes(config?.theme as PanelTheme) ? config!.theme as PanelTheme : 'auto'
}

/** The colors to draw with: the app's own for Automatic. */
export function themeColors(theme: PanelTheme, app: PanelColors): PanelColors {
  return theme === 'auto' ? app : palettes[theme]
}

/** Which kind of surface the panel draws on, for colors a panel picks per surface itself. */
export function themeSurface(theme: PanelTheme, brightness: PanelEnvironment['brightness']): 'light' | 'dark' | 'teal' {
  return theme === 'auto' ? brightness : theme
}

/** The settings field that picks a placement's theme, saved under `theme`. */
export function themeField(locale?: string): SettingsField {
  const t = locale?.startsWith('es') ? labels.es : labels.en
  return { type: 'field', fieldType: 'select', key: 'theme', label: t.theme, value: 'auto', options: PANEL_THEMES.map(theme => ({ value: theme, label: t.themes[theme] })) }
}
