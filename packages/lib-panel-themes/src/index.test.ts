// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PanelColors } from './index.ts'
import { panelTheme, themeColors, themeField, themeSurface } from './index.ts'

const app = { surface: '#123456' } as PanelColors

test('a placement saved without a theme, or with one this version does not know, follows the app', () => {
  assert.equal(panelTheme({}), 'auto')
  assert.equal(panelTheme(undefined), 'auto')
  assert.equal(panelTheme({ theme: 'pink' }), 'auto')
  assert.equal(panelTheme({ theme: 'teal' }), 'teal')
  assert.equal(themeColors('auto', app), app)
  assert.equal(themeSurface('auto', 'dark'), 'dark')
})

test('Light, Dark and Teal draw their own colors whatever the app shows', () => {
  assert.equal(themeColors('teal', app).surface, '#a9c4cb')
  assert.equal(themeColors('light', { ...app }).surface, '#f5fafc')
  assert.equal(themeColors('dark', app).surface, '#0f1416')
  assert.equal(themeSurface('teal', 'light'), 'teal')
})

test('the settings field offers every theme, in the operator\'s language', () => {
  const field = themeField('es')
  assert.equal(field.type === 'field' && field.key, 'theme')
  assert.deepEqual(field.type === 'field' && (field.options as { value: string }[]).map(o => o.value), ['auto', 'light', 'dark', 'teal'])
  assert.equal(field.type === 'field' && field.label, 'Tema')
})
