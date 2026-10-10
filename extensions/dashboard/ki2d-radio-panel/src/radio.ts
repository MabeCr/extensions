// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import type { JSONValue, PanelHook, PanelRadioState, PanelRadioSet, PanelRadioResult, PanelRadioSpectrumSet, PanelEnvironment, SvgScene, SvgSceneLayer } from '@ham2k/extension-sdk'
type RadioHost = {
  setRadioConnection?(args: { id: string; selection?: string; connected: boolean }): Promise<PanelRadioResult>; listRadios?(): Promise<PanelRadioState[]>
  readRadio(id?: string): Promise<PanelRadioState | null>; setRadio(args: PanelRadioSet): Promise<PanelRadioResult>; setRadioSpectrum?(args: PanelRadioSpectrumSet): Promise<PanelRadioResult>
  kvGet?(key: string): Promise<JSONValue | null>; kvSet?(key: string, value: JSONValue): Promise<void>
}
const en = {
  connect: 'Connect', disconnect: 'Disconnect', mode: 'Mode', radio: 'Radio', automatic: 'Automatic (logging radio)', theme: 'Theme', light: 'Light', meterScale: 'Switch signal scale between dBm and S-units', power: 'Power', powerAdjust: 'Adjust power', antenna: 'Antenna', rxAntenna: 'Receive antenna', txAntenna: 'Transmit antenna', filter: 'Receive filter: shift and width', filterLow: 'Receive filter low edge', filterHigh: 'Receive filter high edge',
  display: 'Display', both: 'Panadapter and waterfall', panOnly: 'Panadapter only', waterfallOnly: 'Waterfall only', off: 'Off',
  panWidth: 'Panadapter width', speed: 'Waterfall speed',
  colors: 'Waterfall colors', teal: 'Teal', classic: 'Classic', gray: 'Gray', heat: 'Heat', tune: 'Tune frequency', panadapter: 'Panadapter', tuner: 'Antenna tuner', atu: 'ATU', bypass: 'BYPASS', tuning: 'TUNING', tuneFailed: 'ATU FAIL',
  title: 'KI2D’s Radio Panel', description: 'Live CAT readout, meters and panadapter',
  none: 'Select a local radio in Station Configuration', disconnected: 'Disconnected', connecting: 'Connecting',
  connected: 'Connected', stale: 'No current radio data', error: 'Radio error', disconnecting: 'Disconnecting',
  unavailable: 'Radio API unavailable', changed: 'The selected radio changed. Try again.',
  transmitting: 'Tuning is unavailable while transmitting.', invalid: 'Unsupported radio command.',
  rejected: 'Radio is not connected or its readings are stale.', awaiting: 'Awaiting radio confirmation', unconfirmed: 'Radio has not confirmed the requested tune',
}
const es: typeof en = {
  connect: 'Conectar', disconnect: 'Desconectar', mode: 'Modo', radio: 'Radio', automatic: 'Automática (radio del registro)', theme: 'Tema', light: 'Claro', meterScale: 'Cambiar la escala de señal entre dBm y unidades S', power: 'Potencia', powerAdjust: 'Ajustar potencia', antenna: 'Antena', rxAntenna: 'Antena de recepción', txAntenna: 'Antena de transmisión', filter: 'Filtro de recepción: desplazamiento y ancho', filterLow: 'Borde inferior del filtro', filterHigh: 'Borde superior del filtro',
  display: 'Pantalla', both: 'Panorámico y cascada', panOnly: 'Solo panorámico', waterfallOnly: 'Solo cascada', off: 'Apagada',
  panWidth: 'Ancho del panorámico', speed: 'Velocidad de la cascada',
  colors: 'Colores de la cascada', teal: 'Verde azulado', classic: 'Clásicos', gray: 'Grises', heat: 'Calor', tune: 'Sintonizar frecuencia', panadapter: 'Panorámico', tuner: 'Acoplador de antena', atu: 'ATU', bypass: 'BYPASS', tuning: 'AFINANDO', tuneFailed: 'ATU FALLO',
  title: 'Panel de radio de KI2D', description: 'Lecturas CAT, medidores y panorámico',
  none: 'Selecciona una radio local en Configuración de estación', disconnected: 'Desconectada', connecting: 'Conectando',
  connected: 'Conectada', stale: 'Sin datos actuales de la radio', error: 'Error de radio', disconnecting: 'Desconectando',
  unavailable: 'API de radio no disponible', changed: 'Cambió la radio seleccionada. Inténtalo de nuevo.',
  transmitting: 'No se puede sintonizar durante la transmisión.', invalid: 'Comando de radio no compatible.',
  rejected: 'La radio está desconectada o sus datos no son actuales.', awaiting: 'Esperando confirmación de la radio', unconfirmed: 'La radio no confirmó la sintonía solicitada',
}
const words = (locale?: string) => locale?.startsWith('es') ? es : en
const modes = ['LSB', 'USB', 'CW', 'AM', 'FM'] as const
const themes = {
  // The app's teal (#006783, hue 193°), lightened and muted.
  light: { surface: '#a9c4cb', surfaceContainer: '#8faeb7', onSurface: '#000000', onSurfaceVariant: '#1f1f1f', accent: '#000000', primary: '#000000',
    onPrimary: '#a9c4cb', secondary: '#000000', outline: '#40575e', outlineVariant: '#7f9ea7' },
}
type Theme = keyof typeof themes
type MeterScale = 'dbm' | 's'
/** The panafall's settings, as the panel's form stores them. */
type Spectrum = { display: 'both' | 'pan' | 'waterfall' | 'off'; colors: 'teal' | 'classic' | 'gray' | 'heat' }
/** The waterfall's rates a click on its label steps through, in rows a second; the middle one first. */
const waterfallRates = [1, 4, 16]
const defaultWaterfallRate = 1
function spectrumConfig(config: Record<string, unknown>): Spectrum {
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T) => allowed.includes(value as T) ? value as T : fallback
  return {
    display: pick(config.display, ['both', 'pan', 'waterfall', 'off'] as const, 'both'),
    colors: pick(config.colors, ['teal', 'classic', 'gray', 'heat'] as const, 'teal'),
  }
}
/** Hz between the panafall's frequency labels for [span] Hz shown: whole kHz, as the labels show. */
const labelInterval = (span: number) => span <= 10000 ? 1000 : span <= 30000 ? 5000 : span <= 80000 ? 10000 : 25000

/** Which presets the panadapter's width cycles through. */
type PanCategory = 'cw' | 'phone' | 'digital'
const panCategory = (mode?: string | null): PanCategory =>
  mode === 'CW' || mode === 'CW-R' ? 'cw' : ['USB', 'LSB', 'AM', 'FM'].includes(mode ?? '') ? 'phone' : 'digital'
const panWidths: Record<PanCategory, number[]> = { cw: [10000, 50000, 150000], phone: [20000, 75000, 150000], digital: [6000, 30000, 100000] }
/** How the operator has the face arranged, as opposed to what the radio reports. */
type View = { longSwrHold?: boolean; waterfallRate?: number; radio?: string; spectrum?: Spectrum; panWidthHz?: number; theme?: Theme; meterScale?: MeterScale; powerOpen?: boolean; requestedWatts?: number }
/** Above this an SWR reads as a warning. */
const swrWarning = 1.8
const swrHoldMillis = 3000
/** A bad match stays up longer, so it is not missed. */
const swrHighHoldMillis = 10000, swrHigh = 2.0
/** SWR reads in black — above the warning level, bright red — on a white glow that lifts it off the bars. */
const swrColor = '#000000', swrWarningColor = '#ff1a1a', swrGlow = '#ffffff'
/** What is on the air: the transmit bar, and the tuner's pill while it tunes. */
const transmitRed = '#d04a34'

/**
 * Each mode's usual receive passband, in Hz from the tuned frequency — shown, dimmed, for a radio that
 * does not report its own filter.
 */
const passbands: Record<string, [number, number]> = {
  USB: [100, 2800], LSB: [-2800, -100], CW: [-250, 250], AM: [-3000, 3000], FM: [-5000, 5000],
  'DATA-USB': [0, 3000], 'DATA-LSB': [-3000, 0], RTTY: [-250, 250],
}

/** The common widths a click on the passband box offers, by mode. */
const filterWidths: Record<string, number[]> = {
  USB: [1800, 2100, 2400, 2700, 2900, 3300], LSB: [1800, 2100, 2400, 2700, 2900, 3300],
  CW: [50, 100, 250, 500, 1000], RTTY: [250, 500, 1000], AM: [5000, 6000, 8000, 10000], FM: [8000, 10000, 12000],
  'DATA-USB': [1500, 2400, 3000, 3600], 'DATA-LSB': [1500, 2400, 3000, 3600],
}

/**
 * [current] at [width]: sidebands keep the edge nearest the carrier, where the voice starts, as
 * SmartSDR's presets do; everything else keeps its centre.
 */
function widened([low, high]: [number, number], width: number): [number, number] {
  if (low >= 0) return [low, low + width]
  if (high <= 0) return [high - width, high]
  const centre = Math.round((low + high) / 2)
  return [centre - Math.round(width / 2), centre + Math.round(width / 2)]
}

/** `2700` as `2.7K`, `250` as is — the preset menu's labels. */
const hz = (v: number) => v >= 1000 ? `${Number((v / 1000).toFixed(1))}K` : `${v}`

/** A port's name as it fits a pill beside `RX:`: `ANT1` as `A1`, `RX_A` as `RA`, `XVTA` as `XA`. */
const shortPort = (port: string | null) => !port ? '—' : port.replace(/^ANT(\d)$/, 'A$1').replace(/^RX_?([A-Z])$/, 'R$1').replace(/^XVT([A-Z])$/, 'X$1')

/** The scene values the passband box's labels and knobs are bound to. */
const passbandValues = ([low, high]: [number, number]) => ({ pbLow: low, pbHigh: high, pbCentre: Math.round((low + high) / 2), pbWidth: high - low })


/** [a] and [b], `#rrggbb`, mixed [t] of the way to [b] — a translucent colour made opaque over its background. */
function mix(a: string, b: string, t: number) {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return '#' + [0, 1, 2].map(i => Math.round(channel(a, i) * (1 - t) + channel(b, i) * t).toString(16).padStart(2, '0')).join('')
}
export function createRadioPanel(host: RadioHost): PanelHook {
  const placements = new Map<string, {
    id: string | null; selection?: string; requested?: number; dial?: boolean; mode?: string; sent?: number; watts?: number; wattsSent?: number
    /** The scope span last asked of the radio for the panadapter's width: asked once per change. */
    spanAsked?: number
    panCategory?: PanCategory
    /** The filter the box's knobs move from: as last rendered, then as last asked for while scrolling. */
    passband?: [number, number]
    passbandSent?: number
  }>()
  // Outside `placements`, which is reset whenever the radio changes: these are the operator's choices, not the radio's.
  const views = new Map<string, { meterScale?: MeterScale; powerOpen?: boolean; panWidth?: Partial<Record<PanCategory, number>>; waterfallRate?: number }>()
  const view = (key: string) => views.get(key) ?? views.set(key, {}).get(key)!
  // The scale, the span presets and the waterfall's rate are kept per placement across restarts; the
  // power slider's being open is not. Read once, the first time a placement renders.
  const stored = (key: string) => `view:${key}`
  async function restore(key: string) {
    if (views.has(key)) return
    const saved = await host.kvGet?.(stored(key)).catch(() => null)
    const v = view(key)
    if (saved && typeof saved === 'object') {
      const { meterScale, panWidth, waterfallRate } = saved as Record<string, unknown>
      if (meterScale === 'dbm' || meterScale === 's') v.meterScale = meterScale
      if (panWidth && typeof panWidth === 'object') v.panWidth = panWidth as Partial<Record<PanCategory, number>>
      if (typeof waterfallRate === 'number' && waterfallRate >= 0 && waterfallRate < waterfallRates.length) v.waterfallRate = waterfallRate
    }
  }
  function persist(key: string) {
    const { meterScale, panWidth, waterfallRate } = view(key)
    host.kvSet?.(stored(key), JSON.parse(JSON.stringify({ meterScale, panWidth, waterfallRate })) as JSONValue).catch(() => {})
  }
  return {
    async getPanels(_args, ctx) {
      const t = words(ctx.locale)
      const radios = await host.listRadios?.() ?? []
      return [{ key: 'front-face', title: t.title, description: t.description, icon: 'radio-handheld', multiple: true, on: ['tick:1'], form: [
        { type: 'field', fieldType: 'select', key: 'radio', label: t.radio, value: 'auto', options: [
          { value: 'auto', label: t.automatic }, ...radios.filter(r => r.id).map(r => ({ value: r.id!, label: r.name ?? r.id! })),
        ] },
        { type: 'field', fieldType: 'select', key: 'theme', label: t.theme, value: 'light', options: [
          { value: 'light', label: t.light },
        ] },
        { type: 'field', fieldType: 'select', key: 'display', label: t.display, value: 'both', options: [
          { value: 'both', label: t.both }, { value: 'pan', label: t.panOnly }, { value: 'waterfall', label: t.waterfallOnly }, { value: 'off', label: t.off },
        ] },
        { type: 'field', fieldType: 'select', key: 'colors', label: t.colors, value: 'teal', options: [
          { value: 'teal', label: t.teal }, { value: 'classic', label: t.classic }, { value: 'gray', label: t.gray }, { value: 'heat', label: t.heat },
        ] },
      ] } ]
    },
    async render(args, ctx) {
      const t = words(args.environment?.locale ?? ctx.locale)
      if (!args.environment || !args.clock) return { kind: 'markdown', content: t.unavailable }
      const selection = typeof args.config.radio === 'string' && args.config.radio !== 'auto' ? args.config.radio : undefined
      const r = await host.readRadio(selection)
      const key = args.instanceId ?? 'default'
      await restore(key)
      let p = placements.get(key)
      if (!p || p.id !== r?.id || p.selection !== selection) {
        p = { id: r?.id ?? null, selection }; placements.set(key, p)
        if (placements.size > 64) placements.delete(placements.keys().next().value!)
      }
      if (p.requested !== undefined && r?.frequencyHz === p.requested) delete p.requested
      // A dial's last step is not where the radio stays when Smart VFO Snap rounds it: once the dial
      // has been still a moment, the readout follows the radio again.
      if (p.requested !== undefined && p.dial && args.clock.realNowMillis - (p.sent ?? 0) > 1500) delete p.requested
      if (p.mode !== undefined && r?.mode === p.mode) delete p.mode
      // Not a pending confirmation like frequency: a radio rounds power to its own steps, so the
      // request is only held long enough for the slider not to jump back before the report.
      if (p.watts !== undefined && (r?.powerWatts === p.watts || args.clock.realNowMillis - (p.wattsSent ?? 0) > 2000)) delete p.watts
      // Mid-scroll the radio's report lags what was asked: the knobs keep moving from the request.
      if (args.clock.realNowMillis - (p.passbandSent ?? 0) > 1500) p.passband = r?.passband ? [r.passband.lowHz, r.passband.highHz] : undefined
      // The panadapter's width: the scope set to the narrowest span covering it, the display cropped to it.
      const category = panCategory(r?.mode), panWidthHz = panWidths[category][view(key).panWidth?.[category] ?? 1]
      p.panCategory = category
      const spans = r?.spectrum?.spansHz ?? []
      const span = spans.find(s => s * 2 >= panWidthHz) ?? spans[spans.length - 1]
      if (span !== undefined && span !== p.spanAsked && r?.id && r.spectrum && host.setRadioSpectrum) {
        const result = await host.setRadioSpectrum({ id: r.id, ...(selection ? { selection } : {}), spanHz: span })
        if (result.accepted) p.spanAsked = span
      }
      // A bad match's longer hold: the host times the SWR shown, but only here is it known to keep the dBm away.
      const last = r?.lastTransmission
      const longSwrHold = last?.swrAverage != null && last.swrAverage > swrHigh && args.clock.realNowMillis - last.endedAtMillis < swrHighHoldMillis
      const waiting = p.requested !== undefined || p.mode !== undefined
      const pending = waiting ? ((args.clock.realNowMillis - (p.sent ?? 0)) > 5000 ? t.unconfirmed : t.awaiting) : ''
      return { kind: 'svgScene', title: r?.name?.trim() || t.title, scene: radioDocument(args.environment, r, p.requested, pending, {
        ...view(key), radio: selection, spectrum: spectrumConfig(args.config), panWidthHz, longSwrHold, requestedWatts: p.watts,
        theme: typeof args.config.theme === 'string' && args.config.theme in themes ? args.config.theme as Theme : 'light',
      }) }
    },
    async onEvent(args, ctx) {
      const t = words(args.environment?.locale ?? ctx.locale), key = args.instanceId ?? 'default', p = placements.get(key)
      const event = args.event
      if (event.controlId === 'waterfall-rate' && event.phase === 'activate') {
        view(key).waterfallRate = ((view(key).waterfallRate ?? defaultWaterfallRate) + 1) % waterfallRates.length
        persist(key)
        return { values: {} as Record<string, number> }
      }
      if (event.controlId === 'pan-width' && event.phase === 'activate') {
        const category = p?.panCategory ?? 'phone', widths = view(key).panWidth ??= {}
        widths[category] = ((widths[category] ?? 1) + 1) % panWidths[category].length
        persist(key)
        return { values: {} as Record<string, number> }
      }
      if ((event.controlId === 'meter-scale' || event.controlId === 'meter-scale-axis') && event.phase === 'activate') {
        view(key).meterScale = view(key).meterScale === 's' ? 'dbm' : 's'
        persist(key)
        return { values: {} as Record<string, number> }
      }
      if (event.controlId === 'power-pill' && event.phase === 'activate') {
        view(key).powerOpen = !view(key).powerOpen
        return { values: {} as Record<string, number> }
      }
      if (!p?.id) throw new Error(t.rejected)
      const selection = typeof args.config.radio === 'string' && args.config.radio !== 'auto' ? args.config.radio : undefined
      if (selection !== p.selection) throw new Error(t.changed)
      if (event.controlId === 'connection' && event.phase === 'activate' && ['connect', 'disconnect'].includes(event.action)) {
        if (!host.setRadioConnection) throw new Error(t.unavailable)
        const result = await host.setRadioConnection({ id: p.id, ...(selection ? { selection } : {}), connected: event.action === 'connect' })
        if (!result.accepted) throw new Error(result.reason === 'changed' ? t.changed : t.rejected)
        delete p.requested; delete p.mode
        return { values: {} as Record<string, number> }
      }
      let command: PanelRadioSet
      if (event.controlId.startsWith('passband-') && event.phase === 'activate' && event.action.startsWith('width-') && p.passband) {
        const next = widened(p.passband, Number(event.action.slice(6)))
        p.passband = next
        p.passbandSent = args.clock?.realNowMillis ?? 0
        command = { id: p.id, passband: { lowHz: next[0], highHz: next[1] } }
      } else if (event.controlId.startsWith('passband-') && ['change', 'commit'].includes(event.phase) && Number.isFinite(event.value) && p.passband) {
        // Each knob moves one thing and keeps the rest: an edge, the centre (keeping the width), or
        // the width (keeping the centre).
        const [low, high] = p.passband, v = Math.round(event.value!), centre = (low + high) / 2, width = high - low
        const next: [number, number] = event.action === 'pb-low' ? [v, high]
          : event.action === 'pb-high' ? [low, v]
          : event.action === 'pb-shift' ? [Math.round(v - width / 2), Math.round(v + width / 2)]
          : [Math.round(centre - v / 2), Math.round(centre + v / 2)]
        if (next[1] - next[0] < 50) return { values: passbandValues(p.passband) }
        p.passband = next
        p.passbandSent = args.clock?.realNowMillis ?? 0
        command = { id: p.id, passband: { lowHz: next[0], highHz: next[1] } }
      } else if (event.controlId === 'frequency-knob' && event.action === 'tune' && ['change', 'commit'].includes(event.phase) && Number.isFinite(event.value)) {
        command = { id: p.id, frequencyHz: Math.round(event.value! * 1000), dial: true }
      } else if (event.controlId.startsWith('antenna') && event.phase === 'activate' && /^ant-(rx|tx):/.test(event.action)) {
        const port = event.action.slice(7)
        command = { id: p.id, antenna: event.action.startsWith('ant-rx:') ? { rx: port } : { tx: port } }
      } else if (event.controlId === 'panadapter' && event.action === 'tune' && Number.isFinite(event.value)) {
        command = { id: p.id, frequencyHz: Math.round(event.value!) }
      } else if (event.controlId === 'atu-pill' && event.phase === 'activate' && ['tuner-inline', 'tuner-bypass'].includes(event.action)) {
        command = { id: p.id, tunerInline: event.action === 'tuner-inline' }
      } else if (event.controlId === 'power-slider' && event.action === 'power' && ['change', 'commit'].includes(event.phase) && Number.isFinite(event.value)) {
        command = { id: p.id, powerWatts: event.value! }
      } else if (event.controlId === 'mode' && event.phase === 'activate' && event.action.startsWith('mode-') && modes.includes(event.action.slice(5) as typeof modes[number])) {
        command = { id: p.id, mode: event.action.slice(5) as typeof modes[number] }
      } else throw new Error(t.invalid)
      if (selection) command.selection = selection
      const result = await host.setRadio(command)
      if (!result.accepted) throw new Error(result.reason === 'changed' ? t.changed : result.reason === 'transmitting' ? t.transmitting : result.reason === 'invalid' ? t.invalid : t.rejected)
      // The pill follows the radio's report, not the request; the box shows what was asked until the radio answers.
      if (command.tunerInline !== undefined || command.antenna) return { values: {} as Record<string, number> }
      if (command.passband) return { values: passbandValues([command.passband.lowHz, command.passband.highHz]) }
      if (command.powerWatts !== undefined) {
        p.watts = command.powerWatts; p.wattsSent = args.clock?.realNowMillis ?? 0
        return { values: { power: p.watts } }
      }
      if (command.frequencyHz !== undefined) p.dial = command.dial === true
      p.requested = command.frequencyHz ?? p.requested
      p.mode = command.mode ?? p.mode
      p.sent = args.clock?.realNowMillis ?? 0
      // Reported readouts only change on radio telemetry, never on acceptance.
      return { values: { requested: (p.requested ?? result.state?.frequencyHz ?? 0) / 1000 } }
    },
  }
}

export function radioDocument(e: PanelEnvironment, r: PanelRadioState | null, requestedHz?: number, pending = '', view: View = {}): SvgScene {
  const t = words(e.locale), c = { ...e.colors, ...themes[view.theme ?? 'light'] }
  const width = Math.max(1, Math.min(8192, e.width)), height = Math.max(1, Math.min(8192, e.height))
  const left = e.safeInsets.left, top = e.safeInsets.top, w = width - left - e.safeInsets.right, h = height - top - e.safeInsets.bottom
  const requested = (requestedHz ?? r?.frequencyHz ?? 0) / 1000
  const live = r?.status === 'connected' && !r.stale && !r.problem, canTune = live && r.canTune && r.transmitting !== true
  const maxWatts = r?.maxWatts ?? 100, watts = Math.max(0, Math.min(maxWatts, view.requestedWatts ?? r?.powerWatts ?? 0))
  const layers: SvgSceneLayer[] = [], scene: SvgScene = { version: 1, width, height, values: { reported: (r?.frequencyHz ?? 0) / 1000, requested, rf: r?.meters.powerOut ?? 0, power: watts }, layers, controls: [] }
  if (w < 70 || h < 50) return scene
  const label = e.typography.label, line = label.scaledFontSize * label.lineHeight + 4
  function svg(id: string, x: number, y: number, sw: number, sh: number, art: string): SvgSceneLayer {
    return { id, x, y, width: sw, height: sh, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sw} ${sh}">${art}</svg>` }
  }
  function text(id: string, value: string, x: number, y: number, tw: number, role: 'label' | 'display' | 'mono' = 'label', color = c.onSurface, align?: 'start' | 'center' | 'end') {
    const s = e.typography[role], th = s.scaledFontSize * s.lineHeight + 4
    if (tw < 1 || y + th > top + h) return
    layers.push({ id, x, y, width: tw, height: th, text: { literal: value, size: s.fontSize, fontFamily: s.fontFamily ?? undefined, fontWeight: s.fontWeight, lineHeight: s.lineHeight, color, ...(align ? { align } : {}) } })
  }
  layers.push(svg('face', 0, 0, width, height, `<rect width="${width}" height="${height}" fill="${c.surface}"/>`))

  // Top row: mode and power pills stacked on the left, the frequency with the meter under it, and a
  // column on the right — the radio's name and the power button over the tuner's pill. Too narrow for
  // all three, the pills and the passband box move to a row of their own above the panafall.
  const pillWidth = 64, pillGap = 4, pillsHeight = line * 2 + pillGap, iconSize = 14, iconTarget = 28, numberWidth = 64
  // Always the display size — a narrow pane clips the digits rather than shrinking them — in a field
  // as wide as `14,000.000`, the digits right-aligned in it.
  const base = e.typography.display, size = base.fontSize
  const scaled = size * base.scaledFontSize / base.fontSize, digit = scaled * .62
  const fieldWidth = (2 + .5 + 3 + .5 + 1.8) * digit
  const compact = w < 12 + pillWidth + 12 + fieldWidth + 4 + 12 + pillWidth + 12
  const iconX = left + w - 12 - iconSize
  const columnX = left + w - 12 - Math.min(160, Math.max(pillWidth, w * .3))
  const middleX = compact ? left + 12 : left + 12 + pillWidth + 12, middleWidth = columnX - 12 - middleX
  // The frequency and the meter under it, centred in what the button groups leave.
  const frequencyX = middleX + Math.max(0, (middleWidth - fieldWidth - 4) / 2)
  const tuner = r?.tuner ?? null, atuX = left + w - 12 - pillWidth
  const frequencyWidth = Math.max(1, fieldWidth + 4)
  // Under the tuner, the radio's own antenna ports when it has more than one: one pill, or a receive
  // and a transmit pill where the radio picks each on its own.
  const antennas = r?.antennas && (r.antennas.rxPorts.length > 1 || r.antennas.txPorts.length > 1) ? r.antennas : null
  const rightRows = 1 + (tuner ? 1 : 0) + (antennas ? (antennas.separate ? 2 : 1) : 0)
  // Three columns, each from the top: mode, power and passband; frequency and meter; the power button,
  // tuner and antennas. The panafall starts below the longest.
  const rowY = top + 8
  const leftBottom = rowY + pillsHeight + pillGap * 2 + 38, rightBottom = rowY + rightRows * (line + pillGap) - pillGap
  const pill = (id: string, x: number, y: number, fill = c.surfaceContainer) => layers.push(svg(id, x, y, pillWidth, line,
    `<rect width="${pillWidth}" height="${line}" rx="${line / 2}" fill="${fill}"/>`))

  // Mode over power.
  function pills(y: number) {
    const modeY = y, powerY = y + line + pillGap
    pill('power-pill', left + 12, powerY)
    text('power', r?.powerWatts == null ? '— W' : `${r.powerWatts} W`, left + 12, powerY, pillWidth, 'label', c.onSurface, 'center')
    if (canTune) scene.controls!.push({ id: 'power-pill', label: t.powerAdjust, kind: 'button', x: left + 12, y: powerY, width: pillWidth, height: line, event: 'toggle-power' })
    pill('mode-pill', left + 12, modeY)
    text('mode', r?.mode ?? '—', left + 12, modeY, pillWidth, 'label', c.onSurface, 'center')
    if (canTune) scene.controls!.push({ id: 'mode', label: t.mode, kind: 'button', x: left + 12, y: modeY, width: pillWidth, height: line,
      menu: modes.map(mode => ({ label: mode, event: `mode-${mode}` })) })
  }

  // The name and the power button, over the tuner's pill. A long name runs left past the column,
  // over whatever is beside it: drawn after it, on top.
  function rightColumn(y: number, nameFromX: number) {
    const on = r?.status === 'connected' || r?.status === 'connecting'
    const iconY = y + (line - iconSize) / 2
    text('radio-name', r?.name ?? '', nameFromX, y, Math.max(1, iconX - 8 - nameFromX), 'label', c.onSurfaceVariant, 'end')
    layers.push(svg('connection-icon', iconX, iconY, iconSize, iconSize,
      `<g transform="scale(${iconSize / 20})"><path d="M10 2v8M5 5a7 7 0 1 0 10 0" fill="none" stroke="${on ? c.onSurface : c.outline}" stroke-width="2" stroke-linecap="round"/></g>`))
    if (r?.id && r.status !== 'disconnecting') scene.controls!.push({ id: 'connection', label: `${on ? t.disconnect : t.connect} ${r.name ?? t.radio}`, kind: 'button',
      // The icon is small; the place to tap is not.
      x: iconX - (iconTarget - iconSize) / 2, y: iconY - (iconTarget - iconSize) / 2, width: iconTarget, height: iconTarget, event: on ? 'disconnect' : 'connect' })
    if (tuner) {
      const atuY = y + line + pillGap
      // A tune is a carrier on the air: red, like the transmit bar, while it lasts.
      const tuning = tuner === 'tuning'
      pill('atu-pill', atuX, atuY, tuning ? transmitRed : c.surfaceContainer)
      const atuLabel = { inline: t.atu, bypassed: t.bypass, tuning: t.tuning, failed: t.tuneFailed }[tuner]
      text('atu', atuLabel, atuX, atuY, pillWidth, 'label', tuning ? '#ffffff' : tuner === 'bypassed' ? c.outline : c.onSurface, 'center')
      // In line takes the tuner out; anything else puts it back — on a Flex, by tuning.
      if (canTune) scene.controls!.push({ id: 'atu-pill', label: t.tuner, kind: 'button', x: atuX, y: atuY, width: pillWidth, height: line,
        event: tuner === 'inline' ? 'tuner-bypass' : 'tuner-inline' })
    }
    if (antennas) {
      let antY = y + (tuner ? 2 : 1) * (line + pillGap)
      const antennaPill = (id: string, shown: string, ports: string[], event: string, label: string) => {
        pill(`${id}-pill`, atuX, antY)
        text(id, shown, atuX, antY, pillWidth, 'label', c.onSurface, 'center')
        if (canTune) scene.controls!.push({ id, label, kind: 'button', x: atuX, y: antY, width: pillWidth, height: line,
          menu: ports.map(port => ({ label: port, event: `${event}${port}` })) })
        antY += line + pillGap
      }
      if (antennas.separate) {
        antennaPill('antenna-rx', `RX: ${shortPort(antennas.rx)}`, antennas.rxPorts, 'ant-rx:', t.rxAntenna)
        antennaPill('antenna-tx', `TX: ${shortPort(antennas.tx)}`, antennas.txPorts, 'ant-tx:', t.txAntenna)
      } else {
        antennaPill('antenna', antennas.rx ?? antennas.tx ?? '—', antennas.rxPorts, 'ant-rx:', t.antenna)
      }
    }
  }

  // The receive filter: the radio's when it reports one, else the mode's usual one, dimmed.
  const passband: [number, number] | undefined = r?.passband ? [r.passband.lowHz, r.passband.highHz] : passbands[r?.mode ?? '']
  const passbandHeight = 38
  function passbandBox(bx: number, y: number) {
    if (!passband) return
    const bw = numberWidth, bh = passbandHeight, real = r?.passband != null, ink = real ? '#7cc4d3' : '#4f7d88', label = real ? '#d6eef4' : '#7f9ea7'
    const base = bh - 13, top = 7
    // On a frequency scale that takes in both the filter and the tuned frequency, so the line marking
    // the tuned frequency sits where it is: beside the filter in a sideband, inside it in CW or AM.
    const [low, high] = passband, from = Math.min(low, 0), to = Math.max(high, 0), pad = (to - from) * .12
    const x = (f: number) => 4 + (f - from + pad) / (to - from + 2 * pad) * (bw - 8)
    const slope = Math.min(6, (x(high) - x(low)) / 4)
    layers.push(svg('passband-box', bx, y, bw, bh, `<rect width="${bw}" height="${bh}" rx="4" fill="#1f3a42"/>` +
      `<path d="M${x(low)} ${base}L${x(low) + slope} ${top}H${x(high) - slope}L${x(high)} ${base}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>` +
      `<path d="M${x(0)} 3V${base + 2}" stroke="#a3e6f2" stroke-width="3" stroke-linecap="round"/>`))
    // Bound to values, so a scroll redraws the numbers at once rather than at the next render.
    Object.assign(scene.values, passbandValues(passband))
    const small = { size: 8, color: label }, wide = passband[1] - passband[0] >= 1000
    layers.push({ id: 'passband-low', x: bx + 2, y: y + bh - 11, width: bw / 2, height: 11, text: { ...small, value: 'pbLow' } })
    layers.push({ id: 'passband-high', x: bx - 2 + bw / 2, y: y + bh - 11, width: bw / 2, height: 11, text: { ...small, value: 'pbHigh', align: 'end' } })
    // Over the tuned-frequency line on a backing of the box's own colour, so the width stays legible where they cross.
    const labelWidth = 26
    layers.push(svg('passband-width-backing', bx + (bw - labelWidth) / 2, y + top + 5, labelWidth, 11,
      `<rect width="${labelWidth}" height="11" rx="2" fill="#1f3a42" fill-opacity=".75"/>`))
    layers.push({ id: 'passband-width', x: bx, y: y + top + 5, width: bw, height: 11,
      text: { ...small, value: 'pbWidth', align: 'center', ...(wide ? { scale: .001, decimals: 1, suffix: 'K' } : {}) } })
    if (real && canTune) {
      // Scroll on an edge to move it; in the middle, sideways shifts the filter and up/down widens it.
      const step = r?.mode === 'CW' ? 10 : 50, third = bw / 3
      // A click anywhere on the box offers the mode's common widths.
      const presets = filterWidths[r?.mode ?? '']
      const knob = { kind: 'knob' as const, y, height: bh, min: -12000, max: 12000, step, sensitivity: step / 10, continuous: true,
        ...(presets ? { menu: presets.map(width => ({ label: hz(width), event: `width-${width}` })) } : {}) }
      scene.controls!.push({ ...knob, id: 'passband-low', label: t.filterLow, x: bx, width: third, value: 'pbLow', event: 'pb-low' })
      scene.controls!.push({ ...knob, id: 'passband-high', label: t.filterHigh, x: bx + 2 * third, width: third, value: 'pbHigh', event: 'pb-high' })
      scene.controls!.push({ ...knob, id: 'passband-centre', label: t.filter, x: bx + third, width: third, value: 'pbCentre', event: 'pb-shift',
        valueY: 'pbWidth', eventY: 'pb-width', minY: 50, maxY: 12000, stepY: step, sensitivityY: step / 5 })
    }
  }

  if (!compact) pills(rowY)
  // The digits' baseline on the bottom of the power pill, the second of the column beside them. A text
  // layer centres its line in a box 4 taller; the baseline sits half the leading plus the ascent below
  // the line's top (Roboto's ascent .927 and descent .244 of the size).
  const topY = rowY + pillsHeight - 2 - ((base.lineHeight - 1.171) / 2 + .927) * scaled
  const digitsBottom = topY + scaled * base.lineHeight + 4

  if (canTune) {
    // Over the digits, invisible: the wheel steps the frequency, a drag (or a trackpad's two-finger
    // scroll) spins it, and the arrow keys step it once it has focus. Narrow modes take finer steps.
    const fine = ['CW', 'RTTY', 'DATA-USB', 'DATA-LSB'].includes(r?.mode ?? '')
    scene.controls!.push({ id: 'frequency-knob', label: t.tune, kind: 'knob', x: frequencyX, y: rowY, width: frequencyWidth, height: digitsBottom - rowY,
      value: 'requested', min: .001, max: 1e7, step: fine ? .01 : .1, sensitivity: fine ? .002 : .01, event: 'tune', continuous: true })
  }
  // The receive bar below takes the field's width.
  const frequencyEndX = frequencyX + fieldWidth + 4
  if (r?.frequencyHz != null || requestedHz !== undefined) {
    const mhz = Math.floor(requested / 1000)
    const mhzDigits = Math.max(1, String(mhz).length)
    // From 100 MHz up the Hz are noise on the display, and the room goes to the MHz.
    const hz = mhz < 100
    const group = e.locale.startsWith('es') ? '.' : ',', decimal = e.locale.startsWith('es') ? ',' : '.'
    const digits = (mhz > 0 ? mhzDigits + .5 + 3 : Math.max(1, String(Math.floor(requested)).length)) + (hz ? .5 + 1.8 : 0)
    let x = Math.max(frequencyX, frequencyX + fieldWidth - digits * digit)
    function part(id: string, count: number, spec: NonNullable<SvgSceneLayer['text']>, small = false) {
      const partSize = small ? size * .6 : size
      const pw = count * digit
      layers.push({ id, x, y: topY + (small ? scaled * .4 * .85 : 0), width: pw + 4, height: scaled * (small ? .6 : 1) * base.lineHeight + 4,
        text: { size: partSize, fontFamily: base.fontFamily ?? undefined, lineHeight: base.lineHeight, color: live ? c.accent : c.outline, ...spec } })
      x += pw
    }
    if (mhz > 0) {
      part('frequency-mhz', mhzDigits, { value: 'requested', scale: .001, truncate: true, fontWeight: 700 })
      part('frequency-group', .5, { literal: group })
      part('frequency-khz', 3, { value: 'requested', truncate: true, modulo: 1000, minIntegerDigits: 3 })
    } else {
      part('frequency-khz', Math.max(1, String(Math.floor(requested)).length), { value: 'requested', truncate: true, fontWeight: 700 })
    }
    if (hz) {
      part('frequency-decimal', .5, { literal: decimal })
      part('frequency-hz', 1.8, { value: 'requested', scale: 1000, modulo: 1000, minIntegerDigits: 3 }, true)
    }
  } else {
    text('frequency', '— MHz', frequencyX, topY, frequencyWidth, 'display', c.outline)
  }
  rightColumn(rowY, middleX)

  // Digits have no descenders: the meter starts just under their baseline, not under their line's box.
  let y = rowY + pillsHeight + 6
  const status = !r?.id ? t.none : r.stale ? t.stale : t[r.status]
  // As wide as the frequency above it.
  const barX = frequencyX, barWidth = Math.max(1, frequencyEndX - frequencyX)
  if (view.powerOpen && canTune && w >= 220) {
    const trackY = y + 10, thumb = 16
    layers.push(svg('power-track', barX, trackY - 2, barWidth, 4, `<rect width="${barWidth}" height="4" rx="2" fill="${c.surfaceContainer}"/>`))
    layers.push({ ...svg('power-thumb', barX - thumb / 2, trackY - thumb / 2, thumb, thumb, `<circle cx="${thumb / 2}" cy="${thumb / 2}" r="${thumb / 2 - 1}" fill="${c.onSurface}"/>`),
      translateX: { value: 'power', input: [0, maxWatts], output: [0, barWidth] } })
    layers.push({ id: 'power-value', x: Math.min(barX + barWidth + 8, left + w - 12 - numberWidth), y: trackY - line / 2, width: numberWidth, height: line,
      text: { value: 'power', decimals: maxWatts <= 20 ? 1 : 0, suffix: ' W', size: label.fontSize, fontFamily: label.fontFamily ?? undefined, fontWeight: label.fontWeight, lineHeight: label.lineHeight, color: c.onSurface } })
    scene.controls!.push({ id: 'power-slider', label: t.power, kind: 'slider', x: barX - thumb / 2, y: trackY - thumb / 2, width: barWidth + thumb, height: thumb,
      value: 'power', min: 0, max: maxWatts, step: maxWatts <= 20 ? .5 : 1, event: 'power', continuous: true })
    y += 28
  }
  // Under the pills, beside the meter.
  if (!compact && w >= 220 && h >= 160) passbandBox(left + 12, rowY + pillsHeight + pillGap * 2)
  if (w >= 220 && h >= 160) {
    // Drawn from the radio's live values (`scene.radio`), which the host updates as the radio
    // reports them: no render is needed for the bars, the numbers, or the switch between receive
    // and transmit. Only the dBm/S-unit labels, the power ceiling and the SWR hold come from here.
    scene.radio = view.radio ? { node: view.radio } : {}
    // The number sits inside the bar at its left.
    const meterWidth = barWidth, meterX = barX, bar = 18, numberX = meterX + 3, numberY = y + 2, numberW = Math.min(60, meterWidth - 6)
    const rx = { value: 'radio.transmitting', input: [0, 1] as [number, number], output: [1, 0] as [number, number] }
    const tx = { value: 'radio.transmitting', input: [0, 1] as [number, number], output: [0, 1] as [number, number] }
    // Off the scene while receiving: a layer that needs a second condition beside its own opacity.
    const offWhileRx = { value: 'radio.transmitting', input: [0, 1] as [number, number], output: [10000, 0] as [number, number] }
    const track = mix(c.surface, c.outlineVariant, .4)
    const frame = (ticks: number[], majors: number[], at: (v: number) => number) => `<path d="M0 ${bar + 2.5}H${meterWidth}" stroke="${c.onSurface}" stroke-width="1"/>` +
      ticks.map(v => `<path d="M${Math.min(meterWidth - .5, Math.max(.5, at(v)))} ${bar + 2}v${majors.includes(v) ? 6 : 4}" stroke="${c.onSurface}" stroke-width="1"/>`).join('')
    const labelLayers = (id: string, labels: [number, string][], at: (v: number) => number, opacity: typeof rx) => {
      for (const [v, tick] of labels) {
        layers.push({ id: `${id}-${tick}`, x: meterX + at(v) - 14, y: y + bar + 9, width: 28, height: 16, opacity,
          text: { literal: tick, size: 10, color: c.onSurfaceVariant, align: 'center' } })
      }
    }
    const numberText = { size: 10, fontFamily: label.fontFamily ?? undefined, fontWeight: 600, lineHeight: 1.2, color: c.onSurface }

    // Receiving: dBm, linear, with a green/amber/red ramp fixed in place and a track-coloured cover
    // that shrinks from the right as the signal rises. The S-unit scale only relabels it (S9 = -73 dBm).
    const dbmAt = (db: number) => Math.max(0, Math.min(1, (db + 130) / 120)) * meterWidth
    const sUnits = view.meterScale === 's'
    const rxLabels: [number, string][] = sUnits
      ? [[-121, 'S1'], [-109, 'S3'], [-97, 'S5'], [-85, 'S7'], [-73, 'S9'], [-53, '+20'], [-33, '+40']]
      : [-120, -90, -60, -30].map(db => [db, `${db}`])
    // Every 10 dBm; on the S-scale every two S-units from S1 (12 dB), then every 10 dB over S9.
    const rxTicks = sUnits
      ? [...Array.from({ length: 5 }, (_, i) => -121 + i * 12), ...Array.from({ length: 6 }, (_, i) => -63 + i * 10)]
      : Array.from({ length: 13 }, (_, i) => -130 + i * 10)
    layers.push({ ...svg('rx-ramp', meterX, y + 2, meterWidth, bar,
      `<defs><linearGradient id="level" x1="0" x2="1" y1="0" y2="0"><stop offset=".5" stop-color="#2e9e4f"/><stop offset=".5" stop-color="#c98a16"/>` +
      `<stop offset=".8" stop-color="#c98a16"/><stop offset=".8" stop-color="#d04a34"/></linearGradient></defs><rect width="${meterWidth}" height="${bar}" fill="url(#level)"/>`), opacity: rx })
    layers.push({ ...svg('rx-cover', meterX, y + 2, meterWidth, bar, `<rect width="${meterWidth}" height="${bar}" fill="${track}"/>`),
      pivot: [1, .5], scaleX: { value: 'radio.signalDbm', input: [-130, -10], output: [1, 0] }, opacity: rx })
    layers.push({ ...svg('rx-frame', meterX, y, meterWidth, bar + 10, frame(rxTicks, rxLabels.map(([v]) => v), dbmAt)), opacity: rx })
    labelLayers('rx-scale', rxLabels, dbmAt, rx)
    // After a transmission its average SWR holds the number's place — 3 seconds, 10 when it was over
    // 2.0 — timed by the host, so it appears the moment the radio unkeys. The dBm steps aside meanwhile;
    // the longer hold is known only here, so for that one it waits for the hold's render to clear.
    const since = 'radio.secondsSinceTransmit', average = 'radio.swrAverage'
    const offWhileTx = { value: 'radio.transmitting', input: [0, 1] as [number, number], output: [0, 10000] as [number, number] }
    const held = (seconds: number) => ({ value: since, input: [seconds, seconds + .01] as [number, number], output: [1, 0] as [number, number] })
    const above = (swr: number, shown: boolean) => ({ value: average, input: [swr, swr + .001] as [number, number], output: (shown ? [10000, 0] : [0, 10000]) as [number, number] })
    if (!view.longSwrHold) {
      layers.push({ id: 'receive-level', x: numberX, y: numberY, width: numberW, height: bar, opacity: rx,
        translateX: { value: since, input: [swrHoldMillis / 1000, swrHoldMillis / 1000 + .01], output: [10000, 0] }, text: { ...numberText, value: 'radio.signalDbm', suffix: ' dBm' } })
    }
    const heldText = { ...numberText, value: average, prefix: 'SWR ', decimals: 1, color: swrColor, glow: swrGlow }, warningText = { ...heldText, color: swrWarningColor, fontWeight: 700 }
    layers.push({ id: 'swr-held', x: numberX, y: numberY, width: numberW, height: bar, translateY: offWhileTx, opacity: held(swrHoldMillis / 1000), translateX: above(swrWarning, false), text: heldText })
    layers.push({ id: 'swr-held-warning', x: numberX, y: numberY, width: numberW, height: bar, translateY: offWhileTx, opacity: held(swrHoldMillis / 1000), translateX: above(swrWarning, true), text: warningText })
    layers.push({ id: 'swr-held-long', x: numberX, y: numberY, width: numberW, height: bar, translateY: offWhileTx, opacity: held(swrHighHoldMillis / 1000), translateX: above(swrHigh, true), text: warningText })
    scene.controls!.push({ id: 'meter-scale', label: t.meterScale, kind: 'button', x: numberX, y: numberY, width: numberW, height: bar, event: 'toggle-scale', opacity: rx })
    // The scale's own labels switch it too.
    scene.controls!.push({ id: 'meter-scale-axis', label: t.meterScale, kind: 'button', x: meterX - 14, y: y + bar + 7, width: meterWidth + 28, height: 18, event: 'toggle-scale', opacity: rx })

    // Transmitting: RF out against the radio's ceiling, and its SWR.
    const maxWatts = r?.maxWatts ?? 100
    const wattsAt = (v: number) => Math.max(0, Math.min(1, v / maxWatts)) * meterWidth
    const watts = (v: number) => `${Number(v.toFixed(v < 10 && v % 1 ? 1 : 0))}`
    const txLabels: [number, string][] = [.25, .5, .75, 1].map(f => [f * maxWatts, f === 1 ? `${watts(maxWatts)} W` : watts(f * maxWatts)])
    layers.push({ ...svg('tx-track', meterX, y + 2, meterWidth, bar, `<rect width="${meterWidth}" height="${bar}" fill="${track}"/>`), opacity: tx })
    layers.push({ ...svg('tx-fill', meterX, y + 2, meterWidth, bar, `<rect width="${meterWidth}" height="${bar}" fill="${transmitRed}"/>`),
      pivot: [0, .5], scaleX: { value: 'radio.powerOut', input: [0, maxWatts], output: [0, 1] }, opacity: tx })
    layers.push({ ...svg('tx-frame', meterX, y, meterWidth, bar + 10, frame(Array.from({ length: 11 }, (_, i) => i * maxWatts / 10), txLabels.map(([v]) => v), wattsAt)), opacity: tx })
    labelLayers('tx-scale', txLabels, wattsAt, tx)
    layers.push({ id: 'tx-swr', x: numberX, y: numberY, width: numberW, height: bar, opacity: tx, text: { ...numberText, value: 'radio.swr', prefix: 'SWR ', decimals: 1, color: swrColor, glow: swrGlow } })
    // The same number in red over it, faded in above the warning level.
    layers.push({ id: 'tx-swr-warning', x: numberX, y: numberY, width: numberW, height: bar, translateX: offWhileRx,
      opacity: { value: 'radio.swr', input: [swrWarning, swrWarning + .001], output: [0, 1] },
      text: { ...numberText, value: 'radio.swr', prefix: 'SWR ', decimals: 1, color: swrWarningColor, fontWeight: 700, glow: swrGlow } })
    y += Math.max(line, bar + 26) + 6
  }
  // Narrow: the pills and the passband box, in a row of their own above the panafall.
  // The panafall below the longest column.
  y = Math.max(y, rightBottom + 10, compact || w < 220 || h < 160 ? 0 : leftBottom + 10)
  if (compact) {
    pills(y)
    passbandBox(left + 12 + pillWidth + 8, y)
    y += Math.max(pillsHeight, passbandHeight) + 10
  }
  const bottom = top + h - line - 6
  // A tune's confirmation is transient: it never takes room from the panadapter, whose size would
  // otherwise jump with every click. Only a lasting state — a problem, no connection — does.
  const lasting = r?.problem || (!live ? status : '')
  const panBottom = lasting ? bottom - 6 : top + h - 8
  const sp = view.spectrum ?? spectrumConfig({})
  const panadapter = sp.display !== 'off' && r?.id !== undefined && r?.id !== null && panBottom - y >= (sp.display === 'both' ? 100 : 60)
  const notice = lasting || (panadapter ? '' : pending)
  if (notice) text('confirmation', notice, left + 12, bottom, w - 24, 'label', c.onSurfaceVariant)
  // The rest of the panel, drawn by the host from the radio's own scope; a click tunes there.
  if (panadapter) {
    // Painted just after the face, so the width label below it draws on top.
    scene.controls!.push({ id: 'panadapter', label: t.panadapter, kind: 'spectrum', x: left + 12, y, width: w - 24, height: panBottom - y, after: 'face',
      ...(view.panWidthHz ? { span: view.panWidthHz } : {}),
      ...(view.radio ? { radio: view.radio } : {}), display: sp.display as 'both' | 'pan' | 'waterfall', split: .5, follow: .15, event: 'tune',
      // A click lands on the nearest step: 50 Hz in CW, 500 Hz in phone; data and RTTY land where clicked.
      ...({ CW: { tuneStep: 50 }, USB: { tuneStep: 500 }, LSB: { tuneStep: 500 }, AM: { tuneStep: 500 }, FM: { tuneStep: 500 } } as Record<string, { tuneStep: number }>)[r?.mode ?? ''],
      // Each waterfall row is the loudest since the last; teal is quiet in the panadapter's own colour.
      waterfallSpeed: waterfallRates[view.waterfallRate ?? defaultWaterfallRate],
      // A tighter window than the panadapter's 80 dB, just above the noise: a weak signal lights up
      // where the trace would barely lift.
      waterfallFloor: 3, waterfallRange: 50,
      ...(sp.colors === 'teal' ? { waterfallColors: ['#1f3a42', '#2c5c68', '#3f8a9b', '#7cc4d3', '#d6eef4', '#ffffff'] } : { palette: sp.colors }),
      center: { pan: { color: '#a3e6f2', width: 3 }, waterfall: { color: '#a3e6f2', width: 3 } },
      overlays: passband ? [{ from: passband[0], to: passband[1], pan: { fill: '#40d6eef4' }, waterfall: { fill: '#26ffffff' } }] : [],
      backgroundColor: '#1f3a42', traceColor: '#d6eef4', fillColor: '#66d6eef4', fillColorBottom: '#00d6eef4', gridColor: '#36565f', gridDashed: true,
      // Labels always in MHz to the kHz, so they come at whole-kHz steps that suit the span.
      scale: { gap: 18, background: '#1f3a42', ticks: { color: '#a9c4cb', width: 1, offset: 0, length: 4 },
        labels: { color: '#a9c4cb', size: 10, offset: 4, decimals: 3, interval: labelInterval(view.panWidthHz ?? 100000) } } })
    // The width shown, top right: what the scope can give, at most the preset. A click steps the presets.
    if (view.panWidthHz) {
      const scopeHz = r?.spectrum?.spansHz?.length ? Math.max(...r.spectrum.spansHz) * 2 : Infinity
      const shownKHz = Math.round(Math.min(view.panWidthHz, scopeHz) / 1000), lw = 54, lx = left + w - 12 - lw - 4, ly = y + 4
      layers.push(svg('pan-width-backing', lx, ly, lw, 16, `<rect width="${lw}" height="16" rx="3" fill="#1f3a42" fill-opacity=".75"/>`))
      layers.push({ id: 'pan-width', x: lx, y: ly + 1, width: lw, height: 15, text: { literal: `${shownKHz} kHz`, size: 10, color: '#d6eef4', align: 'center' } })
      scene.controls!.push({ id: 'pan-width', label: t.panWidth, kind: 'button', x: lx, y: ly, width: lw, height: 16, event: 'pan-width-next' })
    }
    // The waterfall's rate, bottom right. A click steps the rates.
    if (sp.display !== 'pan') {
      const rate = waterfallRates[view.waterfallRate ?? defaultWaterfallRate], lw = 64, lx = left + w - 12 - lw - 4, ly = panBottom - 4 - 16
      layers.push(svg('waterfall-rate-backing', lx, ly, lw, 16, `<rect width="${lw}" height="16" rx="3" fill="#1f3a42" fill-opacity=".75"/>`))
      layers.push({ id: 'waterfall-rate', x: lx, y: ly + 1, width: lw, height: 15, text: { literal: `${rate} ${rate === 1 ? 'row' : 'rows'}/s`, size: 10, color: '#d6eef4', align: 'center' } })
      scene.controls!.push({ id: 'waterfall-rate', label: t.speed, kind: 'button', x: lx, y: ly, width: lw, height: 16, event: 'waterfall-rate-next' })
    }
  }
  return scene
}
