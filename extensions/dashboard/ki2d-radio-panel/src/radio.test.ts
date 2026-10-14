// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { JSONValue, PanelEnvironment, PanelRenderArgs, HookContext, PanelRadioState, PanelRadioSet, PanelRadioSpectrumSet, SvgScene } from '@ham2k/extension-sdk'
import { createRadioPanel, powerSteps, radioDocument } from './radio.ts'

type Host = Parameters<typeof createRadioPanel>[0]
const style = { fontFamily: 'Roboto', fontFamilyFallback: ['NotoColorEmoji'], fontSize: 14, scaledFontSize: 14, fontWeight: 400, lineHeight: 1.2, letterSpacing: 0 }
const environment: PanelEnvironment = {
  version: 1, width: 640, height: 600, safeInsets: { left: 0, top: 0, right: 0, bottom: 0 },
  brightness: 'dark', colors: {
    surface: '#101010', surfaceContainer: '#202020', onSurface: '#eeeeee', onSurfaceVariant: '#bbbbbb',
    accent: '#00ffff', primary: '#00cccc', onPrimary: '#000000', secondary: '#ff00ff',
    outline: '#aaaaaa', outlineVariant: '#555555', error: '#ff0000', onError: '#ffffff',
  },
  typography: { body: style, label: style, title: style, display: { ...style, fontSize: 36, scaledFontSize: 36 }, mono: { ...style, fontFamily: 'RobotoMono' } },
  locale: 'en', textDirection: 'ltr', devicePixelRatio: 2, reducedMotion: false, highContrast: false,
}
const now = Date.UTC(2026, 8, 17, 12)
const args: PanelRenderArgs = { panelKey: 'front-face', operation: { grid: 'FN42' }, qsoCount: 0, config: {}, reason: 'initial', environment, clock: { nowMillis: now, realNowMillis: now } }
const at = (millis: number): PanelRenderArgs => ({ ...args, clock: { nowMillis: millis, realNowMillis: millis } })
const ctx: HookContext = { online: true, locale: 'en', distanceUnits: 'kilometers' }

const live: PanelRadioState = { id: 'rig-a', name: 'Test radio', status: 'connected', stale: false, problem: null, frequencyHz: 14074000, mode: 'USB', powerWatts: 5, transmitting: false, meters: {}, canTune: true }

/** A host whose radio reads [state] and records every command it is sent. */
function radioHost(state: () => PanelRadioState | null, extra: Partial<Host> = {}) {
  const commands: PanelRadioSet[] = []
  const host: Host = { readRadio: async () => state(), setRadio: async command => { commands.push(command); return { accepted: true, state: state() } }, ...extra }
  return { host, commands }
}
const sceneOf = (rendered: Awaited<ReturnType<ReturnType<typeof createRadioPanel>['render']>>): SvgScene => {
  assert.equal(rendered.kind, 'svgScene')
  return (rendered as { scene: SvgScene }).scene
}
const event = (controlId: string, action: string, phase: 'activate' | 'change' | 'commit', value?: number) =>
  ({ ...args, event: { controlId, action, phase, sequence: 1, ...(value === undefined ? {} : { value }) } })
const tuningControls = (scene: SvgScene) => scene.controls!.filter(c => ['frequency-knob', 'mode', 'power-pill', 'atu-pill'].includes(c.id) || /^(passband|antenna)/.test(c.id))

test('a dial tune is a request: the readout shows it until the radio reports one, then follows the radio', async () => {
  let state = { ...live }
  const { host, commands } = radioHost(() => state)
  const panel = createRadioPanel(host)
  await panel.render(args, ctx)
  await panel.onEvent!(event('frequency-knob', 'tune', 'change', 14075.3), ctx)
  // `dial` lets the app's Smart VFO Snap settle it like the radio's own knob.
  assert.deepEqual(commands, [{ id: 'rig-a', frequencyHz: 14075300, dial: true }])
  const pending = sceneOf(await panel.render(args, ctx))
  assert.equal(pending.values.reported, 14074)
  assert.equal(pending.values.requested, 14075.3)
  // Snap rounds where the dial stopped, so the radio never reports the request: once the dial has
  // been still a moment the readout shows where the radio is, rather than holding the request forever.
  state = { ...state, frequencyHz: 14075000 }
  assert.equal(sceneOf(await panel.render(at(now + 500), ctx)).values.requested, 14075.3)
  assert.equal(sceneOf(await panel.render(at(now + 2000), ctx)).values.requested, 14075)
})

test('a disconnected, stale or transmitting radio offers nothing that would command it', () => {
  for (const state of [null, { ...live, status: 'disconnected' as const }, { ...live, stale: true }, { ...live, transmitting: true }]) {
    assert.deepEqual(tuningControls(radioDocument(environment, state)), [], JSON.stringify(state))
  }
  assert.equal(radioDocument(environment, null).layers.find(l => l.id === 'frequency')?.text?.literal, '— MHz')
  assert.ok(tuningControls(radioDocument(environment, { ...live, passband: { lowHz: 100, highHz: 2800 }, tuner: 'inline' })).length >= 6)
})

test('a refusal reaches the operator in words, and a placement whose radio changed sends nothing', async () => {
  const { host, commands } = radioHost(() => live)
  host.setRadio = async command => { commands.push(command); return { accepted: false, reason: 'transmitting', state: live } }
  const panel = createRadioPanel(host)
  await panel.render(args, ctx)
  await assert.rejects(panel.onEvent!(event('mode', 'mode-CW', 'activate'), ctx), /while transmitting/)
  assert.deepEqual(commands, [{ id: 'rig-a', mode: 'CW' }])
  await assert.rejects(panel.onEvent!({ ...event('mode', 'mode-CW', 'activate'), config: { radio: 'rig-b' } }, ctx), /selected radio changed/)
  await assert.rejects(panel.onEvent!(event('fake', 'tune', 'commit', 14000), ctx), /Unsupported/)
  assert.equal(commands.length, 1)
})

test('a placement pinned to a radio reads, commands and draws that radio, whatever the logging radio is', async () => {
  const other = { ...live, id: 'rig-b', name: 'Second radio' }, reads: (string | undefined)[] = []
  const { host, commands } = radioHost(() => other, { listRadios: async () => [live, other], readRadio: async id => { reads.push(id); return id === 'rig-b' ? other : live } })
  const panel = createRadioPanel(host)
  const options = (await panel.getPanels({}, ctx))[0].form![0].options
  assert.ok(Array.isArray(options))
  assert.deepEqual(options.map(o => o.value), ['auto', 'rig-a', 'rig-b'])
  const pinned = { ...args, instanceId: 'pinned', config: { radio: 'rig-b' } }
  const scene = sceneOf(await panel.render(pinned, ctx))
  assert.equal(reads.at(-1), 'rig-b')
  // The live meters and the panadapter come from the host: they must name the same radio.
  assert.deepEqual(scene.radio, { node: 'rig-b' })
  assert.equal(scene.controls!.find(c => c.id === 'panadapter')?.radio, 'rig-b')
  await panel.onEvent!({ ...pinned, event: { controlId: 'panadapter', action: 'tune', phase: 'commit', sequence: 1, value: 14030000 } }, ctx)
  assert.deepEqual(commands, [{ id: 'rig-b', selection: 'rig-b', frequencyHz: 14030000 }])
})

test('the power button connects and disconnects the radio the placement shows', async () => {
  const connections: unknown[] = []
  const { host } = radioHost(() => live, { setRadioConnection: async c => { connections.push(c); return { accepted: true, state: live } } })
  const panel = createRadioPanel(host)
  const pinned = { ...args, config: { radio: live.id } }
  await panel.render(pinned, ctx)
  await panel.onEvent!({ ...pinned, event: { controlId: 'connection', action: 'disconnect', phase: 'activate', sequence: 1 } }, ctx)
  assert.deepEqual(connections, [{ id: live.id, selection: live.id, connected: false }])
})

test('the meters are bound to the host\'s live readings, not drawn from the last render', () => {
  // A render comes once a second at most: a reading baked in as a literal would move the bar at
  // that pace, and keep showing receive for a second after the radio keyed.
  const scene = radioDocument(environment, { ...live, maxWatts: 10, meters: { signalDbm: -93.5 } })
  assert.deepEqual(scene.radio, {})
  assert.equal(scene.layers.find(l => l.id === 'receive-level')?.text?.value, 'radio.signalDbm')
  assert.equal(scene.layers.find(l => l.id === 'rx-cover')?.scaleX?.value, 'radio.signalDbm')
  assert.deepEqual(scene.layers.find(l => l.id === 'tx-fill')?.scaleX, { value: 'radio.powerOut', input: [0, 10], output: [0, 1] })
  assert.equal(scene.layers.find(l => l.id === 'tx-swr')?.text?.value, 'radio.swr')
  assert.ok(!JSON.stringify(scene).includes('-93'))
})

test('a bad match holds its SWR for ten seconds, and the dBm stays away until then', async () => {
  let state: PanelRadioState = { ...live, lastTransmission: { swrAverage: 2.4, endedAtMillis: now - 5000 } }
  const panel = createRadioPanel(radioHost(() => state).host)
  const ids = async (millis = now) => sceneOf(await panel.render(at(millis), ctx)).layers.map(l => l.id)
  assert.ok(!(await ids()).includes('receive-level'))
  assert.ok((await ids()).includes('swr-held-long'))
  assert.ok((await ids(now + 5001)).includes('receive-level'))
  // At the warning level but under 2.0, the ordinary 3-second hold: the host times that one alone.
  state = { ...state, lastTransmission: { swrAverage: 1.9, endedAtMillis: now - 5000 } }
  assert.ok((await ids()).includes('receive-level'))
})

test('the S-unit scale is the operator\'s choice per placement, and survives a restart', async () => {
  const stored = new Map<string, JSONValue>()
  const storage = { kvGet: async (k: string) => stored.get(k) ?? null, kvSet: async (k: string, v: JSONValue) => { stored.set(k, v) } }
  const placement = { ...args, instanceId: 'left' }
  const panel = createRadioPanel(radioHost(() => live, storage).host)
  await panel.render(placement, ctx)
  // The axis labels switch it as well as the number.
  await panel.onEvent!({ ...placement, event: { controlId: 'meter-scale-axis', action: 'toggle-scale', phase: 'activate', sequence: 1 } }, ctx)
  assert.ok(sceneOf(await panel.render(placement, ctx)).layers.some(l => l.id === 'rx-scale-S9'))
  assert.ok(!sceneOf(await panel.render({ ...args, instanceId: 'right' }, ctx)).layers.some(l => l.id === 'rx-scale-S9'))
  const restarted = createRadioPanel(radioHost(() => live, storage).host)
  assert.ok(sceneOf(await restarted.render(placement, ctx)).layers.some(l => l.id === 'rx-scale-S9'))
})

test('a preset width keeps a sideband\'s edge by the carrier, and the centre knob widens about the centre', async () => {
  const state: PanelRadioState = { ...live, passband: { lowHz: 100, highHz: 2800 } }
  const { host, commands } = radioHost(() => state)
  const panel = createRadioPanel(host)
  await panel.render(args, ctx)
  // Moving the low edge with the width would cut the bottom of every voice.
  await panel.onEvent!(event('passband-centre', 'width-1800', 'activate'), ctx)
  assert.deepEqual(commands.at(-1)?.passband, { lowHz: 100, highHz: 1900 })
  await panel.onEvent!(event('passband-centre', 'pb-width', 'change', 1000), ctx)
  assert.deepEqual(commands.at(-1)?.passband, { lowHz: 500, highHz: 1500 })
  await panel.onEvent!(event('passband-centre', 'pb-shift', 'change', 1200), ctx)
  assert.deepEqual(commands.at(-1)?.passband, { lowHz: 700, highHz: 1700 })
  // A filter cannot close: a scroll that would cross the edges is not sent.
  const sent = commands.length
  await panel.onEvent!(event('passband-high', 'pb-high', 'change', 720), ctx)
  assert.equal(commands.length, sent)
})

test('the panadapter keeps a width per kind of mode, and asks the scope for its span only when that changes', async () => {
  let state: PanelRadioState = { ...live, spectrum: { problem: null, mode: 'center', spanHz: 50000, lowHz: null, highHz: null, refLevelDb: null, speed: null,
    spansHz: [2500, 5000, 12500, 25000, 50000, 100000], refMinDb: -30, refMaxDb: 10, refStepDb: 1, modes: ['center'], speeds: [] } }
  const asked: PanelRadioSpectrumSet[] = []
  const panel = createRadioPanel(radioHost(() => state, { setRadioSpectrum: async s => { asked.push(s); return { accepted: true, state } } }).host)
  const span = async () => sceneOf(await panel.render(args, ctx)).controls!.find(c => c.id === 'panadapter')?.span
  assert.equal(await span(), 75000)
  assert.equal(await span(), 75000)
  // The narrowest span that covers it: a span is half the width shown.
  assert.deepEqual(asked, [{ id: 'rig-a', spanHz: 50000 }])
  await panel.onEvent!(event('pan-width', 'pan-width-next', 'activate'), ctx)
  assert.equal(await span(), 150000)
  state = { ...state, mode: 'CW' }
  assert.equal(await span(), 50000, 'CW keeps its own preset')
  state = { ...state, mode: 'LSB' }
  assert.equal(await span(), 150000, 'back on phone, the phone choice')
})

test('a tune shows in the transmit bar\'s red, as the carrier it is', () => {
  const art = (tuner: 'inline' | 'tuning') => radioDocument(environment, { ...live, tuner }).layers.find(l => l.id === 'atu-pill')!.svg!
  const label = (tuner: 'inline' | 'tuning') => radioDocument(environment, { ...live, tuner }).layers.find(l => l.id === 'atu')!.text!
  assert.ok(art('tuning').includes('#d04a34'))
  assert.equal(label('tuning').color, '#ffffff')
  assert.ok(!art('inline').includes('#d04a34'))
})

test('a radio that tunes apart from its tuner switch gets a Tune pill beside the ATU pill, and a press tunes', async () => {
  const state = { ...live, tuner: 'bypassed' as const, canStartTune: true }
  const { host, commands } = radioHost(() => state)
  const scene = radioDocument(environment, state)
  const tune = scene.controls!.find(c => c.id === 'tune-pill')!, atu = scene.controls!.find(c => c.id === 'atu-pill')!
  assert.equal(tune.y, atu.y, 'side by side')
  assert.ok(tune.x! + tune.width! <= atu.x!, 'to its left, not over it')
  assert.equal(scene.layers.find(l => l.id === 'tune')?.text?.literal, 'TUNE')
  assert.equal(scene.layers.find(l => l.id === 'atu')?.text?.literal, 'BYPASS')
  const panel = createRadioPanel(host)
  await panel.render(args, ctx)
  await panel.onEvent!(event('tune-pill', 'start-tune', 'activate'), ctx)
  // Alone: the host refuses a tune that rides with any other setting.
  assert.deepEqual(commands, [{ id: 'rig-a', startTune: true }])
})

test('without room for two pills, the Tune pill is a "T" in the one pill\'s width, the tuner\'s words shortened', () => {
  const state = { ...live, tuner: 'bypassed' as const, canStartTune: true }
  const scene = radioDocument({ ...environment, width: 320 }, state)
  const tune = scene.controls!.find(c => c.id === 'tune-pill')!, atu = scene.controls!.find(c => c.id === 'atu-pill')!
  const alone = radioDocument({ ...environment, width: 320 }, { ...state, canStartTune: false }).controls!.find(c => c.id === 'atu-pill')!
  assert.equal(tune.x, alone.x, 'the column does not widen into the frequency')
  assert.equal(atu.x! + atu.width!, alone.x! + alone.width!)
  assert.equal(scene.layers.find(l => l.id === 'tune')?.text?.literal, 'T')
  assert.equal(scene.layers.find(l => l.id === 'atu')?.text?.literal, 'BYP')
})

test('no Tune pill where the radio cannot start one apart — a Flex, whose in line is the tune — nor while one runs', () => {
  const flex = radioDocument(environment, { ...live, tuner: 'bypassed', canStartTune: false })
  assert.equal(flex.controls!.find(c => c.id === 'tune-pill'), undefined)
  assert.equal(flex.layers.find(l => l.id === 'tune'), undefined)
  // Pressed again mid-tune it would key the radio over its own carrier.
  const tuning = radioDocument(environment, { ...live, tuner: 'tuning', canStartTune: true })
  assert.equal(tuning.controls!.find(c => c.id === 'tune-pill'), undefined)
  assert.ok(tuning.layers.find(l => l.id === 'tune-pill')!.svg!.includes('#d04a34'), 'red, like the carrier it is')
})

test('too narrow for three columns, only the left column moves, to a row above the panafall', () => {
  const state = { ...live, tuner: 'inline' as const, passband: { lowHz: 100, highHz: 2800 } }
  const top = (scene: SvgScene, id: string) => scene.controls!.find(c => c.id === id)!.y!
  const wide = radioDocument(environment, state), narrow = radioDocument({ ...environment, width: 320 }, state)
  assert.equal(top(wide, 'mode'), top(wide, 'frequency-knob'))
  assert.ok(top(narrow, 'mode') > top(narrow, 'meter-scale'))
  assert.ok(top(narrow, 'mode') < top(narrow, 'panadapter'))
  assert.ok(top(narrow, 'atu-pill') < top(narrow, 'meter-scale'))
})

test('a radio picking receive and transmit antennas apart gets a pill for each', async () => {
  const antennas = { rxPorts: ['ANT1', 'ANT2', 'RX_A'], txPorts: ['ANT1', 'ANT2'], rx: 'RX_A', tx: 'ANT1', separate: true }
  const { host, commands } = radioHost(() => ({ ...live, antennas }))
  const scene = radioDocument(environment, { ...live, antennas })
  assert.equal(scene.layers.find(l => l.id === 'antenna-rx')?.text?.literal, 'RX: RA')
  assert.equal(scene.layers.find(l => l.id === 'antenna-tx')?.text?.literal, 'TX: A1')
  assert.deepEqual(scene.controls!.find(c => c.id === 'antenna-rx')?.menu?.map(m => m.label), ['ANT1', 'ANT2', 'RX_A'])
  const panel = createRadioPanel(host)
  await panel.render(args, ctx)
  await panel.onEvent!(event('antenna-tx', 'ant-tx:ANT2', 'activate'), ctx)
  assert.deepEqual(commands, [{ id: 'rig-a', antenna: { tx: 'ANT2' } }])
  // One port for both, or only one port: no pill to choose with.
  assert.ok(radioDocument(environment, { ...live, antennas: { ...antennas, separate: false } }).layers.some(l => l.id === 'antenna'))
  assert.ok(!radioDocument(environment, { ...live, antennas: { rxPorts: ['ANT1'], txPorts: ['ANT1'], rx: 'ANT1', tx: 'ANT1', separate: false } }).layers.some(l => l.id.startsWith('antenna')))
})

test('the power pill offers steps that suit the radio\'s maximum, and picking one sets the power', async () => {
  const menu = (maxWatts?: number) => radioDocument(environment, { ...live, maxWatts }).controls!.find(c => c.id === 'power-pill')!.menu!.map(i => i.label)
  assert.deepEqual(menu(5), ['1 W', '2 W', '3 W', '4 W', '5 W'])
  assert.deepEqual(menu(10), ['1 W', '2 W', '5 W', '7 W', '8 W', '10 W'])
  assert.deepEqual(menu(20), ['1 W', '5 W', '10 W', '15 W', '18 W', '20 W'])
  assert.deepEqual(menu(100), ['1 W', '5 W', '20 W', '50 W', '80 W', '90 W', '100 W'])
  assert.deepEqual(menu(200), ['1 W', '5 W', '20 W', '75 W', '100 W', '150 W', '200 W'])
  assert.deepEqual(menu(600), ['1 W', '5 W', '20 W', '100 W', '200 W', '400 W', '600 W'])
  assert.deepEqual(menu(1500), ['1 W', '5 W', '50 W', '100 W', '400 W', '800 W', '1200 W', '1500 W'])
  // A radio stating no maximum is taken for a 100 W one.
  assert.deepEqual(menu(undefined), menu(100))
  // A maximum between the listed ones never offers more than the radio has, and always offers all of it.
  assert.deepEqual(powerSteps(15), [1, 5, 10, 15])
  assert.deepEqual(powerSteps(50), [1, 5, 20, 50])
  assert.deepEqual(powerSteps(300), [1, 5, 20, 100, 200, 300])
  assert.deepEqual(powerSteps(1000), [1, 5, 50, 100, 400, 800, 1000])
  assert.deepEqual(powerSteps(2000), [1, 5, 50, 100, 400, 800, 1200, 1500, 2000])
  const { host, commands } = radioHost(() => live)
  const panel = createRadioPanel(host)
  await panel.render(args, ctx)
  await panel.onEvent!(event('power-pill', 'watts-50', 'activate'), ctx)
  assert.deepEqual(commands, [{ id: 'rig-a', powerWatts: 50 }])
  // The pill shows the radio's report, which a radio rounds to its own steps, not the step picked.
  assert.equal(sceneOf(await panel.render(args, ctx)).layers.find(l => l.id === 'power')?.text?.literal, '5 W')
})
