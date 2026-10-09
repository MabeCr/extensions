// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// A little friend for your POTA activations. It hatches as a sprout, is fed for every contact you log,
// grows with each one, and at ten (an activation) evolves into a critter; from there every ten contacts
// is a celebration. See behavior.ts for what it does and progress.ts for how it knows.
//
// The panel is drawn every second, so the creature can move: a drawing is a step, and the host glides
// its layers between steps. It needs nothing from the network and asks for no permission.

import { defineExtension } from "@ham2k/extension-sdk"
import type { HookContext, JSONValue, PanelContent, PanelDescriptor, PanelHook, PanelRenderArgs, PanelSceneEventResult } from "@ham2k/extension-sdk"

import manifest from "../manifest.json" with { type: "json" }
import { frameAt } from "./behavior.ts"
import { countContacts, observe, pet } from "./progress.ts"
import { buildScene } from "./scene.ts"
import type { Weather } from "./props.ts"
import { words } from "./words.ts"

const nowMillis = (args: PanelRenderArgs): number => args.clock?.realNowMillis ?? Date.now()

/// The operation's uuid, or `""` for a host that has not given one.
const uuidOf = (args: PanelRenderArgs): string => (typeof args.operation?.uuid === "string" ? args.operation.uuid : "")

const weatherOf = (args: PanelRenderArgs): Weather => (args.environment?.brightness === "dark" ? "night" : "day")

/// The POTA parks the operation is activating, as `K-1234 Park Name` each.
function parksOf(operation: Record<string, JSONValue> | undefined): string[] {
  const refs = Array.isArray(operation?.refs) ? (operation.refs as Record<string, JSONValue>[]) : []
  return refs
    .filter((r) => r?.type === "potaActivation" && typeof r.ref === "string" && r.ref)
    .map((r) => [r.ref, typeof r.name === "string" ? r.name : ""].filter(Boolean).join(" "))
}

/// A reaction that a pat does not interrupt.
const BIG = new Set(["treat", "evolve", "fireworks", "backflip", "dance", "confetti"])

export const PotagotchiPanel: PanelHook = {
  async getPanels(_args: Record<string, never>, _ctx: HookContext): Promise<PanelDescriptor[]> {
    return [
      {
        key: "friend",
        title: "KM4BE Potagotchi",
        description: "A little friend that grows with every contact of your POTA activation",
        icon: "paw",
        // Every second, so it can move; and at once when a contact is logged, so it can react.
        on: ["operation", "qsoLogged", "tick:1"],
      },
    ]
  },

  async render(args: PanelRenderArgs, ctx: HookContext): Promise<PanelContent> {
    const now = nowMillis(args)
    const uuid = uuidOf(args)
    const count = await countContacts(ctx, uuid, args.qsoCount)
    const reaction = await observe(uuid, count, now)
    const frame = frameAt(count, reaction, now)
    return { kind: "scene", scene: buildScene(frame, count, weatherOf(args), words(uuid, count, parksOf(args.operation))) }
  },

  async onEvent(args, _ctx): Promise<PanelSceneEventResult> {
    if (args.event.action === "pet") pet(uuidOf(args), nowMillis(args), (r) => BIG.has(r.kind) && nowMillis(args) - r.at < 8000)
    // The panel is drawn again after every event, so there is nothing to patch; but an answer that names nothing
    // counts as a failure, so it names a value that nothing is drawn from.
    return { values: { pat: 1 } }
  },
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook("panel", { key: manifest.key, hook: PotagotchiPanel })
  },
})
