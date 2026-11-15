// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The Partial Call Checks panel: more of the calls the typed text could be than
// the line under the call info has room for, read the way that line reads
// them, and a tap on one puts it in the call field.

import { host } from "@ham2k/extension-sdk"
import type {
  JSONValue,
  PanelContent,
  PanelDescriptor,
  PanelEnvironment,
  PanelHook,
  PanelRenderArgs,
  PanelScene,
  PanelSceneControl,
  PanelSceneEvent,
  PanelSceneLayer,
  PanelSceneLayoutNode,
} from "@ham2k/extension-sdk"

import { compareLetters, letterRuns } from "./letters.ts"
import type { Letter, LetterKind } from "./letters.ts"
import type { Candidate } from "./rank.ts"
import type { CandidateVerdict, HookContext25 } from "./sdkGap.ts"
import { searchCalls, searchError, typedCall } from "./search.ts"
import type { Sources } from "./search.ts"

export const PANEL_KEY = "matches"

/// Shown, at most.
const SHOWN = 30

/// `scoreCandidates` takes at most this many calls at a time.
const SCORE_BATCH = 20

export type Arrangement = "likely" | "source" | "match"

export type Translate = (key: string, options?: Record<string, unknown>) => string

export interface Shown {
  candidate: Candidate
  verdict: CandidateVerdict | null
}

export interface Group {
  title?: string
  entries: Shown[]
}

/// The app's own colours for what the line marks, which the render
/// environment does not carry: its `important` green and its multiplier
/// orange, for each brightness.
const IMPORTANT = { light: "#1AA01A", dark: "#1AC81A" }
const MULTIPLIER = { light: "#C2500F", dark: "#FF8A4C" }

/// A letter a call adds: bold and brighter than the important green, so it
/// stands apart from the letters typed beside it. The app's suggestions
/// line uses the same.
const ADDED_LETTER = { light: "#00B400", dark: "#3CF03C" }

type Typography = { fontFamily: string | null; fontSize: number; scaledFontSize?: number }
type Environment = Pick<PanelEnvironment, "width" | "height" | "brightness"> & {
  colors: Pick<PanelEnvironment["colors"], "onSurface" | "onSurfaceVariant" | "error">
  typography: Record<"mono" | "label", Typography>
}

/// For a host that sends no environment.
const FALLBACK_ENVIRONMENT: Environment = {
  width: 320,
  height: 240,
  brightness: "light",
  colors: { onSurface: "#1C1B1F", onSurfaceVariant: "#49454F", error: "#B3261E" },
  typography: { mono: { fontFamily: "RobotoMono", fontSize: 14 }, label: { fontFamily: null, fontSize: 12 } },
}

/// A monospaced character's width for its size: the calls are drawn in the
/// mono role so that a cell, a strike through a call and where each of its
/// differently coloured runs of letters starts are found without measuring
/// text.
const MONO_ADVANCE = 0.6

const PAD = 8

/// The bar drawn where a call leaves out a letter typed, and the room on
/// each side of it.
const LEFT_OUT_BAR = 2
const LEFT_OUT_MARGIN = 1
const LEFT_OUT_SLOT = LEFT_OUT_BAR + 2 * LEFT_OUT_MARGIN
const CELL_INSET = 6

export function panelDescriptor(t: Translate): PanelDescriptor {
  return {
    key: PANEL_KEY,
    title: t("panelTitle"),
    description: t("panelDescription"),
    icon: "account-search",
    on: ["qso", "qsoLogged"],
    form: [
      {
        type: "field",
        fieldType: "select",
        key: "arrange",
        label: t("arrange"),
        value: "likely",
        options: [
          { value: "likely", label: t("arrangeLikely") },
          { value: "source", label: t("arrangeSource") },
          { value: "match", label: t("arrangeMatch") },
        ],
      },
      { type: "field", fieldType: "checkbox", key: "explain", label: t("explain"), value: false },
    ],
  }
}

function arrangementOf(config: Record<string, JSONValue>): Arrangement {
  return config.arrange === "source" || config.arrange === "match" ? config.arrange : "likely"
}

const says = (verdict: CandidateVerdict | null, code: string) => !!verdict && (verdict.notices.includes(code) || verdict.alerts.includes(code))

/// The strongest source a call was found in, for the arrangement by source.
function sourceOf({ foundIn }: Candidate): "operation" | "contest" | "logs" | "scp" {
  if (foundIn.operation) return "operation"
  if (foundIn.contest) return "contest"
  if (foundIn.logs) return "logs"
  return "scp"
}

/// The groups [shown] falls into, each titled, in the order they show; the
/// ranked list is one untitled group. Within a group, the ranking holds.
export function arrange(shown: Shown[], arrangement: Arrangement, t: Translate): Group[] {
  if (arrangement === "likely") return [{ entries: shown }]
  const keys = arrangement === "source" ? ["operation", "contest", "logs", "scp"] : ["close", "oneEdit"]
  const keyOf = (entry: Shown) => (arrangement === "source" ? sourceOf(entry.candidate) : entry.candidate.match === "oneEdit" ? "oneEdit" : "close")
  return keys.map((key) => ({ title: t(`group_${key}`), entries: shown.filter((entry) => keyOf(entry) === key) })).filter((group) => group.entries.length > 0)
}

/// What the second line says of a call: what the scorers said of it, where
/// it was found, and whether it is a character off what was typed.
export function explanation({ candidate, verdict }: Shown, t: Translate): string {
  const { foundIn } = candidate
  const parts: string[] = []
  if (says(verdict, "duplicate")) parts.push(t("why_dupe"))
  if (says(verdict, "newMult")) parts.push(t("why_mult"))
  // The translator has no plurals: a count of one has its own words.
  const counted = (key: string, count: number, options: Record<string, unknown> = {}) => t(count === 1 ? `${key}Once` : key, { count, ...options })
  if (foundIn.operation) parts.push(counted("why_operation", foundIn.operation))
  if (foundIn.contest) parts.push(counted("why_contest", foundIn.contest))
  if (foundIn.logs) {
    const { count, lastAtMillis } = foundIn.logs
    parts.push(lastAtMillis === null ? counted("why_logs", count) : counted("why_logsLast", count, { year: new Date(lastAtMillis).getUTCFullYear() }))
  }
  if (foundIn.scp) parts.push(t("why_scp"))
  if (candidate.match === "oneEdit") parts.push(t("why_oneEdit"))
  return parts.join(" · ")
}

const environmentOf = (args: PanelRenderArgs): Environment => (args.environment as Environment | undefined) ?? FALLBACK_ENVIRONMENT

/// One line saying why there are no calls to show.
export function statusScene(text: string, args: PanelRenderArgs): PanelScene {
  const env = environmentOf(args)
  return {
    version: 1,
    width: env.width,
    height: env.height,
    values: {},
    layers: [],
    controls: [{ id: "status", label: text, kind: "nativeText" }],
    layout: { column: [{ control: "status" }], padding: PAD },
  }
}

/// The calls in cells laid out by the app's grid: the ranked list wraps
/// across the pane, each group under its title, and an explained call takes
/// a row of its own. A tap on a call sends `pick`, the call in its control's
/// id.
export function matchesScene(
  groups: Group[],
  options: { typed: string; reads?: string; note?: string; explain: boolean; args: PanelRenderArgs; t: Translate },
): PanelScene {
  const env = environmentOf(options.args)
  const brightness = env.brightness === "dark" ? "dark" : "light"
  const { mono, label } = env.typography
  // The app scales text by the OS text size: a text layer is given its
  // unscaled size, and everything placed around its letters is measured at
  // the scaled one.
  const scaled = (role: Typography) => role.scaledFontSize ?? role.fontSize
  const scale = scaled(mono) / mono.fontSize
  const advance = scaled(mono) * MONO_ADVANCE
  const slot = LEFT_OUT_SLOT * scale
  const callHeight = Math.ceil(scaled(mono) * 1.5)
  const whyHeight = Math.ceil(scaled(label) * 1.4)
  const lettersOf = new Map(groups.flatMap((group) => group.entries.map((entry) => [entry.candidate.call, compareLetters(options.typed, entry.candidate.call)] as const)))
  // A call as drawn: its letters, and a bar with its margins for each one
  // typed that it leaves out.
  const drawnWidth = (letters: Letter[]) => letters.reduce((sum, letter) => sum + (letter.kind === "removed" ? slot : advance), 0)
  const longest = Math.max(6 * advance, ...[...lettersOf.values()].map(drawnWidth))
  const width = options.explain ? Math.max(120, Math.floor(env.width - 2 * PAD)) : Math.ceil(longest) + 2 * CELL_INSET
  const height = 4 + callHeight + (options.explain ? whyHeight : 0)

  const layers: PanelSceneLayer[] = []
  const controls: PanelSceneControl[] = []
  const cells: { id: string; width: number; height: number }[] = []
  const cellFor = (entry: Shown): PanelSceneLayoutNode => {
    const id = `c${cells.length}`
    const { call } = entry.candidate
    const dupe = says(entry.verdict, "duplicate")
    const typedHere = call === (options.reads ?? options.typed)
    const accent = dupe
      ? env.colors.error
      : typedHere
        ? IMPORTANT[brightness]
        : says(entry.verdict, "newMult")
          ? MULTIPLIER[brightness]
          : (entry.verdict?.alerts ?? []).some((alert) => alert !== "duplicate")
            ? IMPORTANT[brightness]
            : null
    // As on the line: an accent is bold, and so is a call worked here; a
    // dupe's red and its strike say it, and bold is kept for the one the
    // field reads.
    const bold = dupe ? typedHere : accent !== null || !!entry.candidate.foundIn.operation
    const color = accent ?? env.colors.onSurface
    // Each letter says how it differs from what was typed, bold: green
    // added, red changed, and a red bar where a letter typed is left
    // out. The letters the text has keep the call's own colour and weight.
    const letterColor: Record<LetterKind, string> = { same: color, added: ADDED_LETTER[brightness], removed: env.colors.error, changed: env.colors.error }
    const letters = lettersOf.get(call) ?? []
    cells.push({ id, width, height })
    let bars = 0
    letterRuns(letters).forEach((run, k) => {
      const x = CELL_INSET + Math.round(run.start * advance + bars * slot)
      if (run.kind === "removed") {
        // A bar for each letter left out, each with its margins.
        const count = run.text.length
        bars += count
        const slots = count * slot
        const rects = Array.from(
          { length: count },
          (_, i) =>
            `<rect x="${(i * LEFT_OUT_SLOT + LEFT_OUT_MARGIN) * scale}" y="${callHeight * 0.15}" width="${LEFT_OUT_BAR * scale}" height="${callHeight * 0.7}" fill="${letterColor.removed}"/>`,
        ).join("")
        layers.push({
          id: `${id}-call-${k}`,
          cell: id,
          x,
          y: 2,
          width: slots,
          height: callHeight,
          svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${slots} ${callHeight}">${rects}</svg>`,
        })
        return
      }
      layers.push({
        id: `${id}-call-${k}`,
        cell: id,
        x,
        y: 2,
        width: width - CELL_INSET - x,
        height: callHeight,
        text: {
          literal: run.text,
          size: mono.fontSize,
          color: letterColor[run.kind],
          fontWeight: bold || run.kind !== "same" ? 700 : 400,
          ...(mono.fontFamily ? { fontFamily: mono.fontFamily } : {}),
        },
      })
    })
    if (dupe) {
      const strike = Math.ceil(drawnWidth(letters))
      layers.push({
        id: `${id}-strike`,
        cell: id,
        x: CELL_INSET,
        y: 2,
        width: strike,
        height: callHeight,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${strike} ${callHeight}"><rect x="0" y="${callHeight / 2 - 0.75}" width="${strike}" height="1.5" fill="${color}"/></svg>`,
      })
    }
    if (options.explain) {
      layers.push({
        id: `${id}-why`,
        cell: id,
        x: CELL_INSET,
        y: 2 + callHeight,
        width: width - 2 * CELL_INSET,
        height: whyHeight,
        text: { literal: explanation(entry, options.t), size: label.fontSize, color: env.colors.onSurfaceVariant, ...(label.fontFamily ? { fontFamily: label.fontFamily } : {}) },
      })
    }
    controls.push({ id: `pick:${call}`, label: call, kind: "button", cell: id, x: 0, y: 0, width, height, event: "pick" })
    return { cell: id }
  }

  const children: PanelSceneLayoutNode[] =
    groups.length === 1 && !groups[0].title
      ? groups[0].entries.map(cellFor)
      : groups.map((group) => ({ grid: group.entries.map(cellFor), ...(group.title ? { style: { title: group.title } } : {}) }))
  return {
    version: 1,
    width: env.width,
    height: env.height,
    values: {},
    layers,
    controls,
    cells,
    layout: { grid: children, unit: [width, height], gap: [4, 2], padding: PAD, ...(options.note ? { style: { title: options.note } } : {}) },
  }
}

/// The verdicts for [ranked]'s calls, asked in the batches
/// `scoreCandidates` takes: null where the scorers have nothing to say.
async function verdictsFor(ranked: Candidate[], qso: Record<string, JSONValue> | undefined, operationUuid: string, ctx: HookContext25) {
  const score = ctx.scoreCandidates?.bind(ctx)
  if (!score) return null
  const mode = typeof qso?.mode === "string" ? qso.mode : undefined
  const asQso = (call: string) => ({ their: { call }, ...(qso?.band ? { band: qso.band } : {}), ...(mode ? { mode } : {}) })
  const batches: Record<string, Record<string, JSONValue>>[] = []
  for (let i = 0; i < ranked.length; i += SCORE_BATCH) batches.push(Object.fromEntries(ranked.slice(i, i + SCORE_BATCH).map(({ call }) => [call, asQso(call)])))
  const answers = await Promise.all(batches.map((candidates) => score(candidates, { operationUuid })))
  // Null is the operation leaving the front; a batch answered before it did
  // would mark some calls and leave the rest looking safe to pick.
  if (answers.some((answer) => answer === null)) return null
  return Object.assign({}, ...answers) as Record<string, CandidateVerdict>
}

/// The list the pane last showed, and the one held while the field reads a
/// call picked from it.
let shownFor: { operationUuid: string; typed: string; top: Candidate[] } | null = null
let held: { operationUuid: string; typed: string; top: Candidate[]; picked: string } | null = null

export function partialCallsPanel(deps: { t: (ctx: unknown) => Translate; sources: () => Sources }): PanelHook {
  return {
    async getPanels(_args, ctx) {
      return [panelDescriptor(deps.t(ctx))]
    },

    async render(args, hookCtx): Promise<PanelContent> {
      const ctx = hookCtx as HookContext25
      const t = deps.t(hookCtx)
      const operationUuid = args.operation.uuid as string
      const typed = typedCall(args.qso)
      if (!typed) {
        held = null
        return { kind: "scene", scene: statusScene(t("panelTypeMore"), args) }
      }
      // While the field reads a call picked here, the list it was picked
      // from stays, as the line keeps its list while a pick stands: a
      // wrong tap is put right with another, not by typing the call again.
      const holding = held && held.operationUuid === operationUuid && held.picked === typed ? held : null
      if (!holding) held = null
      let top: Candidate[]
      let missing = false
      if (holding) {
        top = holding.top
      } else {
        const mode = typeof args.qso?.mode === "string" ? args.qso.mode : undefined
        const clock = args.clock ?? { nowMillis: Date.now(), realNowMillis: Date.now() }
        const search = searchCalls(ctx, deps.sources(), { operation: args.operation, typed, mode, clock })
        if (!search) return { kind: "scene", scene: statusScene(t("panelUnsupported"), args) }
        const { ranked, failures } = await search
        top = ranked.slice(0, SHOWN)
        // A render that throws shows no calls at all, so a source that
        // failed fails the pane only when nothing else was found; otherwise
        // the pane says calls may be missing.
        if (failures.length > 0 && top.length === 0) throw searchError(failures)
        missing = failures.length > 0
        if (top.length === 0) return { kind: "scene", scene: statusScene(t("panelNone", { typed }), args) }
      }
      shownFor = { operationUuid, typed: holding?.typed ?? typed, top }
      // Unscored, a dupe would look as safe to pick as any call: the pane
      // says so rather than leaving them unmarked silently.
      let verdicts: Record<string, CandidateVerdict> | null = null
      let unscored = false
      try {
        verdicts = await verdictsFor(top, args.qso, operationUuid, ctx)
      } catch (error) {
        console.error("Partial Calls: the scorers failed", error)
        unscored = true
      }
      const shown = top.map((candidate) => ({ candidate, verdict: verdicts?.[candidate.call] ?? null }))
      const groups = arrange(shown, arrangementOf(args.config), t)
      const note = [missing ? t("panelSomeMissing") : null, unscored ? t("panelUnscored") : null].filter((line) => line !== null).join(" · ") || undefined
      return {
        kind: "scene",
        scene: matchesScene(groups, { typed: holding?.typed ?? typed, reads: typed, note, explain: args.config.explain === true, args, t }),
      }
    },

    async onEvent({ event, operation }: PanelRenderArgs & { event: PanelSceneEvent }) {
      if (event.action === "pick" && event.controlId.startsWith("pick:")) {
        const call = event.controlId.slice("pick:".length)
        const operationUuid = operation.uuid as string
        const { accepted } = await host.updateDraft({ their: { call } }, { operationUuid })
        // The pane says the action failed: a logged contact is open in
        // place of the one being typed, or the operation is no longer open.
        if (!accepted) throw new Error(`Partial Calls: ${call} could not be put in the call field: no contact is being typed in this operation`)
        if (shownFor && shownFor.operationUuid === operationUuid) held = { ...shownFor, picked: call }
      }
      return { values: {} }
    },
  }
}
