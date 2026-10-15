// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import type { JSONValue, PanelEnvironment, PanelTypography, PanelHook, PanelScene, PanelSceneControl, PanelSceneLayer, SceneBinding, SettingsField } from '@ham2k/extension-sdk'
import { type Contacts, HOUR, MINUTE, contactTimes, extremes, lastRate, rateAt } from './rates.ts'

const en = {
  title: 'KI2D’s Rate Chart', description: 'QSO rates over the trailing 10 and 60 minutes',
  update: 'This panel needs a newer version of Ham2K Logger.', noLog: 'This panel cannot read the log here.',
  empty: 'No QSOs in this time span', short: '10 minute rate', long: '60 minute rate', perHour: 'QSO/h', min: 'Min', max: 'Max', lastTen: 'Last 10 QSOs', goal: 'Goal', goalField: 'Rate goal, QSOs/h', goalNone: 'None',
  perOperatorField: 'Multi-operator', overall: 'Overall',
  span: 'Time span', spans: { '1': 'Last hour', '3': 'Last 3 hours', '6': 'Last 6 hours', '12': 'Last 12 hours', '24': 'Last 24 hours', op: 'Whole operation' },
}
const es: typeof en = {
  title: 'Gráfico de ritmo de KI2D', description: 'Ritmo de QSOs en los últimos 10 y 60 minutos',
  update: 'Este panel necesita una versión más reciente de Ham2K Logger.', noLog: 'Este panel no puede leer el registro aquí.',
  empty: 'Sin QSOs en este período', short: 'Ritmo en 10 minutos', long: 'Ritmo en 60 minutos', perHour: 'QSO/h', min: 'Mín', max: 'Máx', lastTen: 'Últimos 10 QSOs', goal: 'Meta', goalField: 'Meta de ritmo, QSOs/h', goalNone: 'Ninguna',
  perOperatorField: 'Multioperador', overall: 'General',
  span: 'Período', spans: { '1': 'Última hora', '3': 'Últimas 3 horas', '6': 'Últimas 6 horas', '12': 'Últimas 12 horas', '24': 'Últimas 24 horas', op: 'Toda la operación' },
}
const words = (locale?: string) => locale?.startsWith('es') ? es : en

type Span = keyof typeof en.spans
const DEFAULT_SPAN: Span = '3'
const spanOf = (config: Record<string, JSONValue>): Span => typeof config.span === 'string' && config.span in en.spans ? config.span as Span : DEFAULT_SPAN
const goalOf = (config: Record<string, JSONValue>): number | undefined => {
  const goal = Number(config.goal)
  return goal > 0 && Number.isFinite(goal) ? goal : undefined
}
const perOperatorOf = (config: Record<string, JSONValue>) => config.perOperator === true || config.perOperator === 'true'
/** No theme role is orange, and the goal line must stand apart from both rate lines and the bar. */
const GOAL_COLOR = '#f57c00'

export function createRatePanel(): PanelHook {
  /** Which chart each pane shows large in a compact stack, by its key: '' for Overall, else the operator. */
  const current = new Map<string, string>()
  return {
    async getPanels(_args, ctx) {
      const t = words(ctx.locale)
      const form: SettingsField[] = [{
        type: 'field', fieldType: 'select', key: 'span', label: t.span, value: DEFAULT_SPAN,
        options: Object.entries(t.spans).map(([value, label]) => ({ value, label })),
      }, { type: 'field', fieldType: 'number', key: 'goal', label: t.goalField, placeholder: t.goalNone },
      { type: 'field', fieldType: 'checkbox', key: 'perOperator', label: t.perOperatorField, value: false }]
      return [{ key: 'rate', title: t.title, description: t.description, icon: 'chart-line', on: ['qsoLogged', 'operation', 'tick:30'], form }]
    },
    async render(args, ctx) {
      const t = words(args.environment?.locale ?? ctx.locale)
      if (!args.environment || !args.clock) return { kind: 'markdown', content: t.update }
      if (!ctx.getQsos) return { kind: 'markdown', content: t.noLog }
      const qsos = await ctx.getQsos(String(args.operation.uuid ?? ''))
      if (qsos === null) return { kind: 'markdown', content: t.noLog }
      const scene = rateScene(args.environment, contactTimes(qsos), args.clock.nowMillis, spanOf(args.config), goalOf(args.config), perOperatorOf(args.config), current.get(args.instanceId ?? ''),
        String(args.operation.operatorCall || args.operation.stationCall || '').trim().toUpperCase())
      return { kind: 'scene', scene }
    },
    // The host renders again after every event, and that render lays the stack out around the pick.
    async onEvent(args) {
      if (args.event.action.startsWith(SELECT)) current.set(args.instanceId ?? '', args.event.action.slice(SELECT.length))
      return { values: {} }
    },
  }
}

const niceStep = (rough: number) => {
  const power = 10 ** Math.floor(Math.log10(rough)), f = rough / power
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * power
}
const TICK_MINUTES = [5, 10, 20, 30, 60, 180, 360, 720, 1440]

/**
 * Which line the pointer is over, in each chart's scene value `focus<n>`: each line's hover regions write
 * its band (a slider writes anywhere from its min to its max), the rest of its chart writes 0.
 * `hoverExit` is HALO-800's proposal — the value a host writes when the pointer leaves, and a
 * tap's toggle; a host without it ignores the key and the markers wait for the next region.
 */
const FOCUS_BANDS = { short: 1, long: 2, lastTen: 3 }
const focusShows = (band: number): SceneBinding => ({ value: 'focus', input: [0, 4], output: [0, 0], samples: Array.from({ length: 9 }, (_, i) => i / 2 >= band && i / 2 < band + 1 ? 1 : 0) })
const REGIONS_PER_LINE = 12
/**
 * A scene holds at most 64 controls and 128 layers, and a host refuses the whole scene past either.
 * A chart takes two controls besides its lines' regions, and up to about 20 layers plus the time axis's.
 */
const MAX_CONTROLS = 64, MAX_CHARTS = 5, MAX_TICKS = 16
/** A compact chart takes a button and about five layers, so a stack stays well inside both limits. */
const MAX_COMPACT = 8
const SELECT = 'select:'

/**
 * How many charts a compact stack shows besides the current one: as many as fit with the current chart
 * at least [minH] tall and each of the rest a third of it, but never under [compactMin].
 */
export function compactStack(avail: number, others: number, minH: number, compactMin: number, pad: number) {
  for (let k = Math.min(others, MAX_COMPACT); k > 0; k--) {
    const mainH = (avail - pad * k) / (1 + k / 3)
    if (mainH >= minH && mainH / 3 >= compactMin) return { shown: k, mainH, compactH: mainH / 3 }
  }
  return { shown: 0, mainH: avail, compactH: 0 }
}

export function rateScene(e: PanelEnvironment, contacts: Contacts, now: number, span: Span, goal?: number, perOperator = false, current = '', atKey = ''): PanelScene {
  const t = words(e.locale), c = e.colors, style = e.typography.label
  const width = Math.max(1, Math.min(8192, e.width)), height = Math.max(1, Math.min(8192, e.height))
  const layers: PanelSceneLayer[] = [], controls: (PanelSceneControl & { hoverExit?: number })[] = []
  const values: Record<string, number> = {}
  const scene: PanelScene = { version: 1, width, height, values, layers, controls }
  const line = style.scaledFontSize * style.lineHeight + 4, charWidth = style.scaledFontSize * .62, pad = 8
  const gutter = charWidth * 3 + 6, barW = (charWidth * 3 + 4) / 3, barLabelW = charWidth * 3 + 2
  const barR = width - e.safeInsets.right - pad, barL = barR - barW
  const plotL = e.safeInsets.left + pad, plotR = barL - 3 - barLabelW - gutter, plotW = plotR - plotL
  const areaT = e.safeInsets.top + pad, areaB = height - e.safeInsets.bottom - pad
  let art = `<rect width="${width}" height="${height}" fill="${c.surface}"/>`
  const svg = (content: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${content}</svg>`
  const finish = () => {
    layers.unshift({ id: 'art', x: 0, y: 0, width, height, svg: svg(art) })
    return scene
  }
  function text(id: string, literal: string, x: number, y: number, w: number, color: string, extra: { align?: 'start' | 'center' | 'end'; fontWeight?: number; opacity?: SceneBinding; style?: PanelTypography; height?: number } = {}) {
    if (w < 1) return
    const font = extra.style ?? style
    layers.push({ id, x, y, width: w, height: extra.height ?? line, text: { literal, size: font.fontSize, fontFamily: font.fontFamily ?? undefined, fontWeight: extra.fontWeight ?? font.fontWeight, lineHeight: font.lineHeight, letterSpacing: font.letterSpacing, color, align: extra.align }, opacity: extra.opacity })
  }
  if (plotW < 40 || areaB - areaT - line < 30) return finish()

  const { times } = contacts
  // Half an hour past the last contact, the operation is over: the chart ends at that contact,
  // rounded up to its minute so the last sample counts it, instead of trailing off to zero.
  let lastQso: number | undefined
  for (const time of times) if (time <= now) lastQso = time
  const end = lastQso !== undefined && now - lastQso > 30 * MINUTE ? Math.ceil(lastQso / MINUTE) * MINUTE : now
  const start = span === 'op' ? Math.min(times.find(time => time <= end) ?? end, end - HOUR) : end - Number(span) * HOUR
  // Three-minute steps counted back from the end's minute, so the newest point is always the end.
  const step = 3 * MINUTE * Math.max(1, Math.ceil((end - start) / plotW / (3 * MINUTE)))
  const last = Math.floor(end / MINUTE) * MINUTE, samples: number[] = []
  for (let time = last; time >= start; time -= step) samples.unshift(time)
  const inSpan = (list: number[]) => list.filter(time => time > start - HOUR && time <= end).length
  const measure = (times: number[]) => {
    const series = [
      { key: 'short', label: t.short, window: 10 * MINUTE, color: c.onSurfaceVariant, stroke: 1.5 },
      { key: 'long', label: t.long, window: HOUR, color: c.accent, stroke: 2.5 },
    ].map(s => {
      const rates = samples.map(time => rateAt(times, time, s.window))
      return { ...s, rates, ...extremes(samples, rates, times, s.window) }
    })
    const lastTen = lastRate(times, end, 10)
    return { times, series, lastTen, top: Math.max(lastTen ?? 0, ...series.flatMap(s => s.rates)) }
  }

  // Under the whole operation, a chart for each operator on the air in the span, the busiest first.
  // The operators share one scale, so their charts compare at a glance. When they cannot all fit,
  // the current one stays large and the rest shrink to a third of it, a tap on a name making it current.
  // The others that fit are Overall, then the operator at the key, then the busiest, shown in the usual order.
  const avail = areaB - areaT - line, minH = line * 2 + 40, compactMin = line + 8
  const operators = perOperator
    ? [...contacts.operators].map(([call, list]) => ({ call, list, count: inSpan(list) })).filter(o => o.count > 0)
      .sort((a, b) => b.count - a.count || a.call.localeCompare(b.call))
    : []
  const entries = [{ key: '', label: undefined as string | undefined, list: times, goal }]
  if (operators.length > 1) {
    entries[0].label = t.overall
    entries.push(...operators.map(o => ({ key: o.call, label: o.call as string | undefined, list: o.list, goal: undefined })))
  }
  const fullFits = Math.max(1, Math.min(MAX_CHARTS, Math.floor((avail + pad) / (minH + pad))))
  const fitted = entries.length > fullFits ? compactStack(avail, entries.length - 1, minH, compactMin, pad) : undefined
  // Too short for a compact chart beside the large one, the pane is Overall alone: a picked operator
  // shown alone would leave no name to tap back to Overall.
  if (fitted && !fitted.shown) {
    entries.splice(1)
    entries[0].label = undefined
  }
  const stack = fitted?.shown ? fitted : undefined
  const selected = stack ? Math.max(0, entries.findIndex(entry => entry.key === current)) : -1
  const atKeyIndex = entries.findIndex(entry => entry.key && entry.key === atKey)
  const others = [0, atKeyIndex, ...entries.keys()].filter((i, n, all) => i >= 0 && i !== selected && all.indexOf(i) === n)
  const picks = new Set(stack ? others.slice(0, stack.shown) : [])
  const shown = stack ? entries.filter((_, i) => i === selected || picks.has(i)) : entries
  const charts = shown.map(entry => ({ ...entry, ...measure(entry.list), large: !stack || entry === entries[selected] }))
  const operatorTop = Math.max(0, ...charts.filter(chart => chart.key).map(chart => chart.top))
  const evenH = (avail - pad * (charts.length - 1)) / charts.length
  const largeCount = charts.filter(chart => chart.large).length
  const regions = Math.min(REGIONS_PER_LINE, Math.floor(((MAX_CONTROLS - (stack ? charts.length : 0)) / largeCount - 2) / 2))
  let plotT = areaT
  charts.forEach((chart, i) => {
    const chartH = !stack ? evenH : chart.large ? stack.mainH : stack.compactH, plotB = plotT + chartH
    const bottom = i === charts.length - 1
    draw(`c${i}`, chart, chart.key ? operatorTop : Math.max(chart.top, goal ?? 0), plotT, plotB, bottom,
      i ? plotT - pad / 2 : 0, bottom ? height : plotB + pad / 2)
    plotT = plotB + pad
  })
  return finish()

  function draw(id: string, chart: typeof charts[number], top: number, plotT: number, plotB: number, axis: boolean, hoverT: number, hoverB: number) {
    const { label, series, lastTen, goal } = chart, plotH = plotB - plotT, focus = `focus-${id}`, small = !chart.large
    const gridStep = top > 0 ? niceStep(Math.max(top, 10) / 3) : 20
    const yMax = Math.max(gridStep, Math.ceil(top / gridStep) * gridStep)
    const px = (time: number) => plotL + (time - start) / (end - start || 1) * plotW
    // A named chart keeps its name's row clear of the lines; a compact one has no row to spare, and lets
    // its lines show faintly through the name's box instead.
    const titleLine = e.typography.title.scaledFontSize * e.typography.title.lineHeight + 2
    const nameStyle = small && plotH < titleLine * 2 ? style : e.typography.title
    const nameLine = nameStyle.scaledFontSize * nameStyle.lineHeight + 2
    const head = small ? 2 : label ? Math.max(line, nameLine) : line
    const py = (value: number) => plotB - value / yMax * (plotH - head)
    // The chart's name holds the top left corner: a grid label on its row gives way, the goal's moves past it.
    const labelW = label ? label.length * nameStyle.scaledFontSize * .68 + 8 : 0

    for (let value = gridStep; value <= yMax && !small; value += gridStep) {
      art += `<path d="M${plotL} ${py(value)} H${plotR}" stroke="${c.outlineVariant}" stroke-dasharray="2 3"/>`
      const y = py(value) - line + 2
      if (label && y < plotT + head) continue
      if (goal === undefined || Math.abs(py(value) - py(goal)) >= line) text(`${id}-grid-${value}`, String(value), plotL + 2, y, charWidth * 5, c.onSurfaceVariant)
    }
    art += `<path d="M${plotL} ${plotB} H${plotR}" stroke="${c.outline}"/>`
    if (goal !== undefined) {
      art += `<path d="M${plotL} ${py(goal)} H${barR}" stroke="${GOAL_COLOR}" stroke-width="1.5"/>`
      const words = `${t.goal} ${Math.round(goal)}`, y = py(goal) - line + 2
      if (!small) text(`${id}-goal`, words, plotL + 2 + (label && y < plotT + head ? labelW : 0), y, words.length * charWidth + 4, GOAL_COLOR, { fontWeight: 600 })
    }

    // A day or less is labelled at least every three hours, on the UTC hours divisible by three.
    // Only the bottom chart carries the labels; the ones above share its time axis.
    const fits = TICK_MINUTES.find(m => (end - start) / (m * MINUTE) <= Math.min(MAX_TICKS, plotW / (charWidth * 6 + 12))) ?? 1440
    const tickStep = (end - start <= 24 * HOUR ? Math.min(fits, 180) : fits) * MINUTE, tickW = charWidth * 6
    const tickX = (time: number) => Math.max(plotL, Math.min(plotR + gutter - tickW, px(time) - tickW / 2))
    const gridLine = (time: number, opacity: number) => { art += `<path d="M${px(time)} ${plotT} V${plotB + (axis ? 3 : 0)}" stroke="${c.outlineVariant}" stroke-opacity="${opacity}"/>` }
    // Unlabelled lines fill in every hour, or every ten minutes across the last hour.
    const minorStep = end - start <= HOUR ? 10 * MINUTE : HOUR
    if (tickStep > minorStep && plotW / ((end - start) / minorStep) >= 4) {
      for (let time = Math.ceil(start / minorStep) * minorStep; time < last; time += minorStep) if (time % tickStep) gridLine(time, .25)
    }
    // Round ticks, plus the end time at the right edge. Labels are placed from the right, so one that
    // would run into its right-hand neighbour — the end time, or one squeezed against the left edge — is left out.
    let labelStart = tickX(last)
    for (let time = Math.ceil(last / tickStep) * tickStep - tickStep; time >= start; time -= tickStep) {
      gridLine(time, .5)
      const x = tickX(time)
      if (!axis || x + tickW + 4 > labelStart) continue
      text(`${id}-tick-${time}`, new Date(time).toISOString().slice(11, 16), x, plotB + 2, tickW, c.onSurfaceVariant, { align: 'center' })
      labelStart = x
    }
    gridLine(last, .5)
    if (axis) text(`${id}-tick-${last}`, new Date(last).toISOString().slice(11, 16), tickX(last), plotB + 2, tickW, c.onSurfaceVariant, { align: 'center' })

    if (label) {
      layers.push({ id: `${id}-name-box`, x: 0, y: 0, width, height, svg: svg(`<rect x="${plotL}" y="${plotT}" width="${labelW}" height="${nameLine}" rx="3" fill="${c.surface}" fill-opacity="${small ? .75 : 1}"/>`) })
      text(`${id}-name`, label, plotL + 2, plotT, labelW - 2, small ? c.accent : c.onSurface, { fontWeight: 700, style: nameStyle, height: nameLine })
      if (small) controls.push({ id: `${id}-select`, kind: 'button', label, event: `${SELECT}${chart.key}`, x: plotL, y: plotT, width: labelW, height: nameLine })
    }

    if (!chart.times.some(time => time > start - HOUR && time <= end)) {
      text(`${id}-empty`, t.empty, plotL, plotT + plotH / 2 - line / 2, plotW, c.onSurfaceVariant, { align: 'center' })
      return
    }

    for (const s of series) {
      const path = s.rates.map((rate, i) => `${i ? 'L' : 'M'}${px(samples[i]).toFixed(1)} ${py(rate).toFixed(1)}`).join(' ')
      art += `<path d="${path}" stroke="${s.color}" stroke-width="${s.stroke}" stroke-linejoin="round" fill="none"/>`
    }

    const shows = (band: number) => ({ ...focusShows(band), value: focus })
    if (!small) inspect()

    // The last-10 bar at the right edge, on the lines' scale.
    art += `<rect x="${barL}" y="${py(yMax)}" width="${barW}" height="${plotB - py(yMax)}" rx="2" fill="${c.outlineVariant}" fill-opacity=".35"/>`
    if (lastTen !== undefined) {
      const barTop = py(lastTen)
      art += `<rect x="${barL}" y="${barTop}" width="${barW}" height="${plotB - barTop}" rx="2" fill="${c.primary}"/>`
      text(`${id}-now-lastTen`, String(Math.round(lastTen)), barL - 3 - barLabelW, Math.max(plotT, Math.min(plotB - line, barTop - line / 2)), barLabelW, c.primary, { align: 'end', fontWeight: 700 })
      if (!small) inspectLastTen(lastTen)
    }

    // The two current rates often sit close together; spread their labels apart rather than overlap them.
    // A compact chart too short for both shows the 60 minute rate alone.
    const current = series.filter(s => !small || plotH >= line * 2 || s.key === 'long')
      .map(s => ({ s, value: s.rates[s.rates.length - 1], y: py(s.rates[s.rates.length - 1]) - line / 2 })).sort((a, b) => a.y - b.y)
    const gap = current.length > 1 ? current[1].y - current[0].y : line
    if (gap < line) {
      current[0].y -= (line - gap) / 2
      current[1].y += (line - gap) / 2
    }
    for (const { s, value, y } of current) {
      text(`${id}-now-${s.key}`, String(Math.round(value)), plotR + 4, Math.max(plotT, Math.min(plotB - line / 2, y)), gutter - 4, s.color, { fontWeight: 700 })
    }

    // Each line's peak, low and description show only while the pointer is over it, or after a tap on it.
    function inspect() {
      values[focus] = 0
      controls.push({ id: `${id}-focus-none`, kind: 'slider', label: label ?? t.title, value: focus, x: 0, y: hoverT, width, height: hoverB - hoverT, min: 0, max: .5, step: .5, hover: true })
      const dot = (x: number, y: number, color: string, filled: boolean) =>
        `<circle cx="${x}" cy="${y}" r="3.5" fill="${filled ? color : c.surface}" stroke="${color}" stroke-width="${filled ? 1 : 2}"/>`
      for (const s of series) {
        const band = FOCUS_BANDS[s.key as keyof typeof FOCUS_BANDS], opacity = shows(band)
        let marks = ''
        for (const [extreme, filled] of [[s.low, false], [s.peak, true]] as const) {
          if (extreme) marks += dot(px(samples[extreme.index]), py(extreme.value), s.color, filled)
        }
        // "60 minute rate: 45 QSO/h", and under it "○ Min: 21, ● Max: 67", at the top left of the plot.
        const title = `${s.label}: ${Math.round(s.rates[s.rates.length - 1])} ${t.perHour}`
        const parts = [
          ...(s.low ? [{ filled: false, words: `${t.min}: ${Math.round(s.low.value)}${s.peak ? ',' : ''}` }] : []),
          ...(s.peak ? [{ filled: true, words: `${t.max}: ${Math.round(s.peak.value)}` }] : []),
        ].map(part => ({ ...part, w: part.words.length * charWidth + 4 }))
        const partsW = parts.reduce((sum, part) => sum + 12 + part.w + 6, 0)
        const boxX = plotL + labelW, boxW = Math.min(plotW - labelW, Math.max(title.length * charWidth + 8, partsW + 4))
        marks += `<rect x="${boxX}" y="${plotT}" width="${boxW}" height="${line * (parts.length ? 2 : 1)}" rx="3" fill="${c.surface}"/>`
        layers.push({ id: `${id}-marks-${s.key}`, x: 0, y: 0, width, height, svg: '', opacity })
        const layer = layers[layers.length - 1]
        text(`${id}-title-${s.key}`, title, boxX + 4, plotT, boxW - 4, s.color, { fontWeight: 600, opacity })
        let partX = boxX + 2
        for (const part of parts) {
          marks += dot(partX + 6, plotT + line * 1.5, s.color, part.filled)
          text(`${id}-${part.filled ? 'max' : 'min'}-${s.key}`, part.words, partX + 12, plotT + line, part.w, s.color, { opacity })
          partX += 12 + part.w + 6
        }
        layer.svg = svg(marks)

        // Regions hug the line a piece at a time, each covering its points and the segment on to the next.
        const per = Math.ceil(samples.length / regions)
        for (let from = 0; from < samples.length; from += per) {
          const to = Math.min(samples.length - 1, from + per), ys = s.rates.slice(from, to + 1).map(py)
          const x = px(samples[from]) - (from ? 0 : 6), right = to === samples.length - 1 ? plotR + gutter : px(samples[to])
          const y = Math.max(0, Math.min(...ys) - 8), bottom = Math.min(height, Math.max(...ys) + 8)
          if (right - x < 1 || bottom - y < 1) continue
          controls.push({ id: `${id}-focus-${s.key}-${from}`, kind: 'slider', label: label ? `${label} ${s.label}` : s.label, value: focus, x: Math.max(0, x), y, width: right - Math.max(0, x), height: bottom - y, min: band, max: band + .5, step: .5, hover: true, hoverExit: 0 })
        }
      }
    }

    function inspectLastTen(lastTen: number) {
      const title = `${t.lastTen}: ${Math.round(lastTen)} ${t.perHour}`, boxW = Math.min(barR - plotL - labelW, title.length * charWidth + 8)
      const opacity = shows(FOCUS_BANDS.lastTen)
      layers.push({ id: `${id}-marks-lastTen`, x: 0, y: 0, width, height, opacity, svg: svg(`<rect x="${barR - boxW}" y="${plotT}" width="${boxW}" height="${line}" rx="3" fill="${c.surface}"/>`) })
      text(`${id}-title-lastTen`, title, barR - boxW, plotT, boxW, c.primary, { align: 'end', fontWeight: 600, opacity })
      controls.push({ id: `${id}-focus-lastTen`, kind: 'slider', label: label ? `${label} ${t.lastTen}` : t.lastTen, value: focus, x: barL - 3 - barLabelW, y: plotT, width: barR - (barL - 3 - barLabelW), height: plotB - plotT, min: FOCUS_BANDS.lastTen, max: FOCUS_BANDS.lastTen + .5, step: .5, hover: true, hoverExit: 0 })
    }
  }
}
