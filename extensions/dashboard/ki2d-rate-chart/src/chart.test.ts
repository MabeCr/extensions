// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { HookContext, PanelEnvironment, PanelScene } from '@ham2k/extension-sdk'
import { createRatePanel, rateScene } from './chart.ts'
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

test('operators that do not all fit share a compact stack: the current chart large, the rest a third of it', () => {
  // The trap is a layout that drops the operators that do not fit, or one where a tap on a name
  // changes nothing: the picked chart must become the large one, wherever it sits in the stack.
  const contacts = log(['A1A', 'A1A', 'A1A', 'A1A', 'B1B', 'B1B', 'B1B', 'C1C', 'C1C', 'D1D'], 600)
  const names = (scene: PanelScene) => scene.layers.filter(layer => layer.id.endsWith('-name')).map(layer => ({ name: layer.text!.literal, y: layer.y }))
  const heights = (scene: PanelScene) => {
    const list = names(scene), bottom = 220 - 8 - (11 * 1.45 + 4)
    return list.map((item, i) => ({ name: item.name, h: (i + 1 < list.length ? list[i + 1].y - 8 : bottom) - item.y }))
  }
  const overall = rateScene(environment(440, 220), contacts, now, '3', undefined, true)
  const first = heights(overall)
  assert.deepEqual(first.map(item => item.name), ['Overall', 'A1A', 'B1B'], 'Overall and the busiest that fit, in order')
  assert.ok(first[1].h <= first[0].h / 3 + 0.01 && first[2].h <= first[0].h / 3 + 0.01, JSON.stringify(first))
  assert.deepEqual(overall.controls!.filter(control => control.kind === 'button').map(control => control.event), ['select:A1A', 'select:B1B'])

  const picked = heights(rateScene(environment(440, 220), contacts, now, '3', undefined, true, 'D1D'))
  assert.deepEqual(picked.map(item => item.name), ['Overall', 'A1A', 'D1D'], 'a picked operator is shown even past the busiest')
  assert.ok(picked[2].h > picked[0].h * 2.9, JSON.stringify(picked))

  const roomy = rateScene(environment(440, 1200), contacts, now, '3', undefined, true, 'D1D')
  assert.equal(names(roomy).length, 5, 'with room for every chart, each gets an even share')
  assert.ok(!roomy.controls!.some(control => control.kind === 'button'))
})

test('a compact stack with room for one operator beside Overall shows the operator at the key', () => {
  // The trap is filling the stack by volume alone: the operator logging now, the one whose rate
  // matters at this moment, is the least busy and would never be shown.
  const contacts = log(['A1A', 'A1A', 'A1A', 'B1B', 'B1B', 'C1C'], 600)
  const names = (scene: PanelScene) => scene.layers.filter(layer => layer.id.endsWith('-name')).map(layer => layer.text!.literal)
  assert.deepEqual(names(rateScene(environment(440, 180), contacts, now, '3', undefined, true)), ['Overall', 'A1A'], 'the busiest without an operator at the key')
  assert.deepEqual(names(rateScene(environment(440, 180), contacts, now, '3', undefined, true, '', 'C1C')), ['Overall', 'C1C'])
  assert.deepEqual(names(rateScene(environment(440, 180), contacts, now, '3', undefined, true, 'B1B', 'C1C')), ['Overall', 'B1B'], 'the current chart still comes first')
})

test('a pane too short for a compact chart shows Overall alone, whichever chart was picked', () => {
  // The trap is the picked operator drawn alone: no compact name is left to tap, so a pane
  // shrunk after a pick could never get back to Overall.
  const contacts = log(['A1A', 'A1A', 'B1B', 'C1C'], 600)
  for (const pick of ['', 'C1C']) {
    const scene = rateScene(environment(440, 140), contacts, now, '3', undefined, true, pick, 'B1B')
    assert.ok(!scene.layers.some(layer => layer.id.endsWith('-name')), `${pick}: one chart, unnamed`)
    assert.ok(!scene.controls!.some(control => control.kind === 'button'), pick)
  }
})

test('a tap on a compact chart\'s name makes it the current chart of that pane only', async () => {
  const panel = createRatePanel()
  const qsos = Array.from({ length: 600 }, (_, i) => ({ startAtMillis: now - (600 - i) * 45000, our: { call: 'W1AW', operatorCall: ['A1A', 'B1B', 'C1C', 'D1D'][i % 4] } }))
  const ctx = { online: true, getQsos: async () => qsos } as unknown as HookContext
  const args = (instanceId: string) => ({ environment: environment(440, 220), clock: { nowMillis: now, realNowMillis: now }, instanceId, panelKey: 'rate', operation: { uuid: 'op' }, qsoCount: 600, config: { perOperator: true }, reason: 'initial' })
  const large = async (instanceId: string) => {
    const result = await panel.render(args(instanceId), ctx)
    const scene = (result as { scene: PanelScene }).scene
    const buttons = new Set(scene.controls!.map(control => control.id))
    return scene.layers.find(layer => layer.id.endsWith('-name') && !buttons.has(layer.id.replace(/-name$/, '-select')))?.text?.literal
  }
  assert.equal(await large('pane-1'), 'Overall')
  await panel.onEvent!({ ...args('pane-1'), event: { controlId: 'c2-select', action: 'select:B1B', phase: 'activate', sequence: 1 } }, ctx)
  assert.equal(await large('pane-1'), 'B1B')
  assert.equal(await large('pane-2'), 'Overall', 'another pane keeps its own pick')
})
