// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// What the party's ref is called, wherever the app shows one.

import type {
  HookContext,
  JSONValue,
  Ref,
  RefHandlerHook,
  RefLink,
  TitleSuggestion,
} from "@ham2k/extension-sdk"

import { withRules } from "@ham2k/lib-contest-rules"

import { ourLocationText, partyRules, str } from "./entry.ts"
import { COUNTY_LINE_SEPARATOR, nameForLocation, splitLocations } from "./location.ts"
import type { QsoPartyParams } from "./params.ts"
import { type Party, resolveParty } from "./party.ts"
import { partyLabel, partySubtitle } from "./activity.ts"

export function qsoPartyRefHandler(params: QsoPartyParams): RefHandlerHook {
  const party: Party = resolveParty(params)

  return {
    /// Nothing to check, and nothing to normalize: the ref's TYPE is the party —
    /// one extension is one party — so a ref of this type is this party's
    /// whatever else it carries. A `normalized` here would be written into the
    /// ref's own `ref` field, which is the redundant second name this extension
    /// deliberately does not keep.
    async validateRef(_args: { ref: Ref }, _ctx: HookContext) {
      return { valid: true }
    },

    async decorateRef({ ref }: { ref: Ref }, _ctx: HookContext): Promise<Ref> {
      const location = str((ref as Record<string, unknown>).location).toUpperCase()
      return withRules({
        ...ref,
        program: 'Contest',
        label: partyLabel(party),
        shortLabel: location ? `${party.short}: ${location}` : party.short,
        // `name` is the activity row's subtitle, and BOTH paths that create this
        // ref have to agree on it — `suggest` writes the ref verbatim without
        // ever calling this hook.
        name: partySubtitle(party),
      }, partyRules(party, (ref as Record<string, unknown>).operator as JSONValue))
    },

    /// "KI2D for NYQP", with the county beneath it.
    async suggestOperationTitle(
      { ref, operation }: { ref: Ref; operation: Record<string, JSONValue> },
      _ctx: HookContext,
    ): Promise<TitleSuggestion | null> {
      const location = ourLocationText(
        party,
        operation as Record<string, unknown>,
        ref as Record<string, unknown>,
      )
      // The county rides in the title — `NJQP: MORR` — because that is what a
      // rover's segment rows have to tell apart, and the title is what they
      // are composed from. The subtitle spells the names out.
      const codes = location ? splitLocations(location).join(COUNTY_LINE_SEPARATOR) : ''
      return {
        for: codes ? `${party.short}: ${codes}` : party.short,
        subtitle: location
          ? splitLocations(location).map((code) => nameForLocation(party, code)).join(' / ')
          : undefined,
      }
    },

    /// The sponsor's own rules — a reference here names a contest, not a place,
    /// so what there is to read about it is the rules it is run under.
    async linkForRef(_args: { ref: Ref }, _ctx: HookContext): Promise<RefLink | null> {
      return party.url ? { url: party.url, label: party.name } : null
    },
  }
}
