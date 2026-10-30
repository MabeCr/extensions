// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// For tests only: some of the rules the app holds a scene to, which refuses the whole scene, with an error naming a control, when
// one is broken. They are in the SDK's docs (scenes.md) or learned from the app's refusals; this file is where they are kept so that
// every page the extension can draw is held to them, not only the ones a test happened to look at.
//
// Not imported by the extension, so it is not in the bundle.

interface Option {
  label?: unknown
  value?: unknown
}
interface Control {
  id: string
  kind: string
  label?: unknown
  value?: string
  options?: Option[]
  after?: string
  fixed?: boolean
  event?: string
  min?: number
  max?: number
  disabled?: boolean
  x?: number
  y?: number
  width?: number
  height?: number
}
interface Layer {
  id: string
  fixed?: boolean
  stretch?: boolean
}
interface LayoutNode {
  control?: string
  row?: LayoutNode[]
  column?: LayoutNode[]
  wrap?: LayoutNode[]
  scene?: boolean
}
export interface SceneLike {
  scroll?: { axis?: string; value?: string; event?: string }
  values?: Record<string, number>
  strings?: Record<string, string>
  layers?: Layer[]
  controls?: Control[]
  layout?: { column?: LayoutNode[] }
}

const CHOICES = new Set(["nativeDropdown", "nativeRadio", "nativeSegmented"])
const NO_VALUE = new Set(["nativeButton", "button", "zoom", "nativeText"])

const controlsOf = (nodes: LayoutNode[] | undefined): string[] =>
  (nodes ?? []).flatMap((n) => [...(n.control ? [n.control] : []), ...controlsOf(n.row), ...controlsOf(n.column), ...controlsOf(n.wrap)])

/// What is wrong with a scene, one sentence each; none when it is as the app wants it.
export function violations(scene: SceneLike): string[] {
  const out: string[] = []
  const values = scene.values ?? {}
  const strings = scene.strings ?? {}
  const controls = scene.controls ?? []
  const layers = scene.layers ?? []

  if (controls.length > 256) out.push(`${controls.length} controls: a scene holds 256`)
  if (layers.length > 512) out.push(`${layers.length} layers: a scene holds 512`)
  if (Object.keys(strings).length > 256) out.push("more than 256 strings")
  if (Object.keys(values).length > 256) out.push("more than 256 values")
  for (const [k, v] of Object.entries(strings)) if (v.length > 4096) out.push(`the string ${k} is over 4096 characters`)
  for (const k of Object.keys(strings)) if (k in values) out.push(`${k} is in values and in strings`)

  const seen = new Set<string>()
  for (const c of controls) {
    if (seen.has(c.id)) out.push(`two controls are named ${c.id}`)
    seen.add(c.id)
    if (typeof c.label !== "string" || !c.label.trim()) out.push(`${c.id} has no label`)

    if (CHOICES.has(c.kind)) {
      const options = c.options ?? []
      // The app refused a dropdown with no options ("Invalid scene control").
      if (options.length === 0) out.push(`${c.id}: a ${c.kind} has no options`)
      if (options.length > 64) out.push(`${c.id}: ${options.length} options, at most 64`)
      const optionValues = options.map((o) => o.value)
      if (new Set(optionValues).size !== optionValues.length) out.push(`${c.id}: two options have the same value`)
      for (const o of options) if (typeof o.value !== "string" || typeof o.label !== "string") out.push(`${c.id}: an option has no label or value`)
      const chosen = c.value !== undefined ? strings[c.value] : undefined
      if (c.value === undefined || chosen === undefined) out.push(`${c.id}: no string holds its choice`)
      else if (chosen !== "" && !optionValues.includes(chosen)) out.push(`${c.id}: its choice "${chosen}" is not one of its options`)
    } else if (c.value !== undefined && !NO_VALUE.has(c.kind) && !(c.value in values) && !(c.value in strings)) {
      out.push(`${c.id}: it is bound to ${c.value}, which the scene does not have`)
    }
    if (c.after !== undefined && !layers.some((l) => l.id === c.after)) out.push(`${c.id}: placed after ${c.after}, which is not a layer`)
  }

  const layerIds = new Set<string>()
  for (const l of layers) {
    if (layerIds.has(l.id)) out.push(`two layers are named ${l.id}`)
    layerIds.add(l.id)
  }

  // A scrolling scene is not laid out, and its scroll position is a value it has.
  if (scene.scroll) {
    if (scene.layout) out.push("a scrolling scene has a layout")
    if (!scene.scroll.value || !(scene.scroll.value in values)) out.push(`the scroll is kept in ${String(scene.scroll.value)}, which is not a value of the scene`)
  }
  // Fixed is for what stays over a scrolling pane.
  if (!scene.scroll) {
    for (const l of layers) if (l.fixed) out.push(`${l.id} is fixed in a scene that does not scroll`)
    for (const c of controls) if (c.fixed) out.push(`${c.id} is fixed in a scene that does not scroll`)
  }
  // The app refused a zoom strip that was fixed: "A zoom strip belongs to a scrolling scene, scrolls with it, and sends an event".
  for (const c of controls.filter((o) => o.kind === "zoom")) {
    if (!scene.scroll) out.push(`${c.id}: a zoom strip is in a scene that does not scroll`)
    if (c.fixed) out.push(`${c.id}: a zoom strip is fixed, and has to scroll with the scene`)
    if (!c.event) out.push(`${c.id}: a zoom strip sends no event`)
    if (typeof c.min !== "number" || typeof c.max !== "number" || !(c.max > c.min)) out.push(`${c.id}: a zoom strip whose factors are ${String(c.min)} to ${String(c.max)} has nothing to zoom to`)
  }

  // In a laid-out scene, every control that has no rect is in the layout exactly once, and none that is not there has none.
  if (scene.layout) {
    const placed = controlsOf(scene.layout.column)
    for (const c of controls) {
      const rect = c.x !== undefined && c.y !== undefined && c.width !== undefined && c.height !== undefined
      const times = placed.filter((id) => id === c.id).length
      if (!rect && times !== 1) out.push(`${c.id}: it has no rect and is in the layout ${times} times`)
      if (rect && times > 0) out.push(`${c.id}: it has a rect and is in the layout`)
    }
    for (const id of placed) if (!controls.some((c) => c.id === id)) out.push(`the layout has ${id}, which is no control`)
  }
  return out
}
