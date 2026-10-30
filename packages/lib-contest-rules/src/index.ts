// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// What a contest's rules allow of the two things the host can turn off for an
// operation: spotting assistance (fetching spots, looking calls up online) and
// self-spotting. The host reads them off the operation's refs — `assistance:
// false` or `selfSpotting: false` forces its switch off, and an absent key
// leaves it to the operator (HaLo's docs/extensions/hooks.md, `ref:<type>`).
//
// A contest states them on its ref from `decorateRef`, which the host runs on
// every setup the operator saves, and on its search suggestions, which the
// host stores verbatim; and shows them in its setup form, as one line that
// follows the entry category the operator picks.

import type { FormMarkdownBlock, HookContext, JSONValue } from "@ham2k/extension-sdk"

import { tFor } from "./i18n.ts"

/// What the rules allow, `true` meaning "permitted". Only ever the rules, never
/// the operator's own choice: a contest that permits assistance does not turn
/// it on, it leaves the operation's switch alone.
export interface ContestRules {
  assistance: boolean
  selfSpotting: boolean
}

/// Rules that forbid neither — the contest has no say.
export const NO_RESTRICTIONS: ContestRules = { assistance: true, selfSpotting: true }

/// [ref] stating [rules]: `false` for what they forbid, and the key REMOVED for
/// what they permit, never `true` — the host reads only `false`, and a ref
/// re-decorated after its category changed must lose the `false` an earlier
/// category left on it.
export function withRules<T extends Record<string, JSONValue | undefined>>(ref: T, rules: ContestRules): T {
  const { assistance: _assistance, selfSpotting: _selfSpotting, ...rest } = ref
  return {
    ...rest,
    ...(rules.assistance ? {} : { assistance: false }),
    ...(rules.selfSpotting ? {} : { selfSpotting: false }),
  } as T
}

/// The rules line: "🟢 Assistance: ON, 🔴 Self-spotting: OFF". The form's
/// markdown has no text color, so the dots carry it.
export function rulesLine(ctx: Pick<HookContext, 'locale'>, rules: ContestRules): string {
  const t = tFor(ctx)
  return [
    `${rules.assistance ? '🟢' : '🔴'} ${t(rules.assistance ? 'assistanceOn' : 'assistanceOff')}`,
    `${rules.selfSpotting ? '🟢' : '🔴'} ${t(rules.selfSpotting ? 'selfSpottingOn' : 'selfSpottingOff')}`,
  ].join(', ')
}

/// A markdown element with the `visibleWhen` the host's form renderer honors on
/// every element, though the SDK types it on fields alone.
export type RulesNote = FormMarkdownBlock & { visibleWhen?: { field: string; equals: JSONValue } }

/// The rules line for a contest whose rules are the same whatever the entry.
export function rulesNote(ctx: Pick<HookContext, 'locale'>, rules: ContestRules): RulesNote {
  return { type: 'markdown', text: rulesLine(ctx, rules) }
}

/// The values a form field holds while nothing has been chosen: a select seeded
/// with `''`, or a field the stored ref has no value for.
const UNDECLARED: JSONValue[] = ['', null]

/// The rules line for a contest whose rules depend on one field of its setup —
/// the operator class, as a rule. One note per distinct verdict, each shown
/// while [field] holds one of the [values] that lead to it, so the line follows
/// the select as the operator changes it; nothing chosen reads as
/// `rulesFor(undefined)`.
///
/// [rulesFor] is the same function `decorateRef` states the flags with, so the
/// form cannot promise one thing and the saved ref do another.
export function rulesNotes<V extends JSONValue>(
  ctx: Pick<HookContext, 'locale'>,
  field: string,
  values: readonly V[],
  rulesFor: (value: V | undefined) => ContestRules,
): RulesNote[] {
  const groups = new Map<string, { rules: ContestRules; values: JSONValue[] }>()
  const add = (rules: ContestRules, value: JSONValue) => {
    const key = `${rules.assistance}/${rules.selfSpotting}`
    const group = groups.get(key) ?? { rules, values: [] }
    group.values.push(value)
    groups.set(key, group)
  }
  for (const value of UNDECLARED) add(rulesFor(undefined), value)
  for (const value of values) add(rulesFor(value), value)

  return [...groups.values()].map(({ rules, values }) => ({
    ...rulesNote(ctx, rules),
    ...(groups.size > 1 ? { visibleWhen: { field, equals: values } } : {}),
  }))
}
