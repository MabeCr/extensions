// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Type part of a callsign into the call field and this pane lists every
// station in the operation's log whose call contains it: "be" finds KM4BE,
// W8ABE and VE3BEP.
//
// Drawn as markdown (see markdown.ts): one line to a station, the letters that
// matched in bold. The host scrolls and themes it, and it renders everywhere.
// An HTML panel would underline them, but the host did not re-render it as the
// call was typed.
//
// VIEW ONLY. A panel cannot write to the call field: `setCallField` is a
// `CommandAction`, and only a `command` hook can return one — a panel's
// `onEvent` answers with scene values and strings. So the pane shows what
// matched and the operator types the rest.
//
// The search is this operation only. `ctx.getQsos` is scoped to one
// operation, there is no call to list the others, and `getHistoryForCall`
// wants a whole call, not a fragment.

import { defineExtension } from "@ham2k/extension-sdk"
import type { HookContext, JSONValue, PanelContent, PanelDescriptor, PanelHook, PanelRenderArgs } from "@ham2k/extension-sdk"

import manifest from "../manifest.json" with { type: "json" }
import { messageMarkdown, resultsMarkdown } from "./markdown.ts"

const DEFAULT_MIN_LETTERS = 2
const DEFAULT_MAX_RESULTS = 50
const MIN_LETTERS_FLOOR = 1
const MAX_RESULTS_FLOOR = 5

type Qso = Record<string, JSONValue>

export interface Match {
  call: string
  name: string
  band: string
  mode: string
  millis: number
  count: number
}

const str = (v: JSONValue | undefined): string => (typeof v === "string" ? v : "")
const obj = (v: JSONValue | undefined): Record<string, JSONValue> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, JSONValue>) : {}

/// The partial the operator is typing. `callField.partial` is the segment
/// under the cursor of a stack or list; `their.call` is the whole field.
export function typedPartial(qso: Qso | undefined): string {
  if (!qso) return ""
  const field = obj(qso.callField)
  const text = str(field.partial) || str(field.call) || str(obj(qso.their).call)
  return text.trim().toUpperCase()
}

/// One row per distinct callsign, carrying its most recent QSO, newest first.
export function searchQsos(qsos: Qso[], partial: string, max: number): Match[] {
  const needle = partial.trim().toUpperCase()
  if (!needle) return []

  const byCall = new Map<string, Match>()
  for (const qso of qsos) {
    const their = obj(qso.their)
    const call = str(their.call).trim().toUpperCase()
    if (!call || !call.includes(needle)) continue
    if (str(qso.band) === "event") continue

    const millis = typeof qso.startAtMillis === "number" ? qso.startAtMillis : 0
    const seen = byCall.get(call)
    if (seen) {
      seen.count += 1
      if (millis < seen.millis) continue
    }

    byCall.set(call, {
      call,
      name: str(their.name) || str(obj(their.guess).name),
      band: str(qso.band),
      mode: str(qso.mode),
      millis,
      count: seen ? seen.count : 1,
    })
  }

  return [...byCall.values()].sort((a, b) => b.millis - a.millis || a.call.localeCompare(b.call)).slice(0, max)
}

/// A whole number of at least `min`. A blank, non-numeric or too-small setting
/// (the number field takes negatives) falls back to the default.
const count = (v: JSONValue | undefined, fallback: number, min: number): number =>
  typeof v === "number" && Number.isFinite(v) && Math.floor(v) >= min ? Math.floor(v) : fallback

export const typeMoreMessage = (minLetters: number): string =>
  `Type at least ${minLetters} ${minLetters === 1 ? "letter" : "letters"} of a callsign.`

export const FuzzySearchPanel: PanelHook = {
  async getPanels(_args: Record<string, never>, _ctx: HookContext): Promise<PanelDescriptor[]> {
    return [
      {
        key: "search",
        title: "KM4BE Callsign Search",
        description: "Previously logged callsigns containing what you are typing",
        icon: "text-search",
        // The draft is what carries the typed call, and the panel is useless
        // without it, so it is declared here rather than per render.
        on: ["qso", "qsoLogged"],
        form: [
          {
            type: "field",
            key: "minLetters",
            fieldType: "number",
            label: "Minimum letters",
            description: `How many letters to type before matching starts. At least ${MIN_LETTERS_FLOOR}; default ${DEFAULT_MIN_LETTERS}.`,
          },
          {
            type: "field",
            key: "maxResults",
            fieldType: "number",
            label: "Maximum matches",
            description: `The longest the list gets; it scrolls. At least ${MAX_RESULTS_FLOOR}; default ${DEFAULT_MAX_RESULTS}.`,
          },
        ],
      },
    ]
  },

  async render(args: PanelRenderArgs, ctx: HookContext): Promise<PanelContent> {
    const minLetters = count(args.config?.minLetters, DEFAULT_MIN_LETTERS, MIN_LETTERS_FLOOR)
    const maxResults = count(args.config?.maxResults, DEFAULT_MAX_RESULTS, MAX_RESULTS_FLOOR)
    const partial = typedPartial(args.qso)

    if (partial.length < minLetters) {
      return { kind: "markdown", content: messageMarkdown(typeMoreMessage(minLetters)) }
    }

    const uuid = str(args.operation?.uuid)
    const qsos = (uuid && (await ctx.getQsos?.(uuid))) || []
    const all = searchQsos(qsos, partial, Infinity)

    if (!all.length) return { kind: "markdown", content: messageMarkdown(`No logged callsign contains ${partial}.`) }
    const shown = all.slice(0, maxResults)
    return { kind: "markdown", content: resultsMarkdown(shown, partial, all.length - shown.length) }
  },
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook("panel", { key: manifest.key, hook: FuzzySearchPanel })
  },
})
