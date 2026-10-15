// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PanelEnvironment, PanelScene } from '@ham2k/extension-sdk'
import { rateScene } from './chart.ts'
import { MINUTE, contactTimes } from './rates.ts'

const style = { fontFamily: 'Roboto', fontFamilyFallback: [], fontSize: 11, scaledFontSize: 11, fontWeight: 500, lineHeight: 1.45, letterSpacing: 0 }
const environment = (width: number, height: number): PanelEnvironment => ({
  version: 1, width, height, safeInsets: { left: 0, top: 0, right: 0, bottom: 0 },
  brightness: 'light', colors: {
    surface: '#ffffff', surfaceContainer: '#eeeeee', onSurface: '#000000', onSurfaceVariant: '#444444',
    accent: '#2266aa', primary: '#aa4422', onPrimary: '#ffffff', secondary: '#884488',
    outline: '#777777', outlineVariant: '#cccccc', error: '#ff0000', onError: '#ffffff',
  },
  typography: { body: style, label: style, title: { ...style, fontSize: 16, scaledFontSize: 16 }, display: style, mono: style },
  locale: 'en', textDirection: 'ltr', devicePixelRatio: 2, reducedMotion: false, highContrast: false,
})
const now = Date.UTC(2026, 9, 13, 15, 30)
const log = (calls: string[], count: number, until = now) => contactTimes(Array.from({ length: count }, (_, i) => ({
  startAtMillis: until - (count - i) * 45000, our: { call: 'W1AW', operatorCall: calls[i % calls.length] },
})))
const texts = (scene: PanelScene) => scene.layers.flatMap(layer => layer.text ? [layer.text.literal] : [])

test('every layout stays within what a host accepts, however many operators and however large the pane', () => {
  // A host refuses the WHOLE scene past 64 controls or 128 layers, and the operator sees only
  // "could not be displayed" — each extra chart brings its own hover regions and labels.
  const contacts = log(['A1A', 'B1B', 'C1C', 'D1D', 'E1E', 'F1F', 'G1G', 'H1H'], 2000)
  for (const [width, height] of [[440, 220], [440, 1200], [2000, 2000], [8192, 8192], [8192, 300]]) {
    for (const span of ['1', '3', '24', 'op'] as const) {
      const scene = rateScene(environment(width, height), contacts, now, span, 75, true)
      assert.ok(scene.layers.length <= 128, `${width}x${height} ${span}: ${scene.layers.length} layers`)
      assert.ok(scene.controls!.length <= 64, `${width}x${height} ${span}: ${scene.controls!.length} controls`)
    }
  }
})

test('half an hour after the last contact the chart ends there, not at the present', () => {
  const lastQso = now - 2 * 60 * MINUTE
  const contacts = log(['A1A'], 200, lastQso)
  const ended = texts(rateScene(environment(440, 220), contacts, now, '3'))
  assert.ok(ended.includes('13:30'), `the right edge reads the last contact's minute: ${ended}`)
  assert.ok(!ended.includes('15:30'))
  const running = texts(rateScene(environment(440, 220), contacts, lastQso + 20 * MINUTE, '3'))
  assert.ok(running.includes('13:50'), 'within half an hour it still ends at the present')
})

test('multi-operator names an overall chart and one per operator, and only when two are on the air', () => {
  const two = texts(rateScene(environment(440, 600), log(['A1A', 'B1B'], 300), now, '3', undefined, true))
  assert.ok(two.includes('Overall') && two.includes('A1A') && two.includes('B1B'))
  const one = texts(rateScene(environment(440, 600), log(['A1A'], 300), now, '3', undefined, true))
  assert.ok(!one.includes('Overall') && !one.includes('A1A'), 'one operator is the overall chart again')
})
