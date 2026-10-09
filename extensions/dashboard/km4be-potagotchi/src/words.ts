// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// What is written under the picture: the creature's name and the park, and how it is getting on.

import { ACTIVATION } from "./behavior.ts"
import type { Words } from "./scene.ts"
import { SPECIES } from "./sprites.ts"
import type { Species } from "./sprites.ts"

/// Names for each friend: a sprout and fox of the woods, a dinosaur, and a radio with a ham's names for things.
export const NAMES: Record<Species, string[]> = {
  sprout: ["Pip", "Moss", "Biscuit", "Fern", "Juniper", "Clover", "Maple", "Nugget", "Sprout", "Pebble", "Willow", "Bramble", "Acorn", "Thistle", "Mallow", "Tumble"],
  dino: ["Rex", "Spike", "Rocky", "Chomp", "Fossil", "Juno", "Ptero", "Dottie", "Stomp", "Tiny", "Gronk", "Fern", "Mesa", "Roary", "Trike", "Bones"],
  radio: ["Watt", "Hertz", "Ohm", "Morse", "Dot", "Dash", "Volt", "Echo", "Static", "Kilo", "Squelch", "Tango", "Ferrite", "Dipole", "Beam", "Baud"],
}

export function hashOf(text: string): number {
  let hash = 0
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return hash
}

/// A name for the creature that is the same every time for the same operation, and different for different ones.
export function nameFor(uuid: string, species: Species = "sprout"): string {
  const names = NAMES[species]
  return names[hashOf(uuid) % names.length]
}

/// Which friend an operation gets: the one chosen in the settings, or, when it is left to chance, one for the operation that is the
/// same every time, so a friend does not turn into another when the app is opened again.
export function speciesFor(uuid: string, chosen: unknown): Species {
  if (typeof chosen === "string" && (SPECIES as string[]).includes(chosen)) return chosen as Species
  return SPECIES[Math.floor(hashOf(`friend:${uuid}`) / 7) % SPECIES.length]
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/// How it feels, by how far along the first ten it is.
function mood(count: number): string {
  if (count === 0) return "hungry"
  if (count <= 3) return "nibbling"
  if (count <= 6) return "growing"
  return "almost there"
}

export function words(uuid: string, count: number, parks: string[], species: Species = "sprout"): Words {
  const name = nameFor(uuid, species)
  const park = parks.length ? parks.join(" + ") : "no park set"
  const header = `${name} · ${park}`

  if (count < ACTIVATION) {
    const left = ACTIVATION - count
    return { header, status: `${name} is ${mood(count)}. ${left} more ${plural(left, "contact", "contacts")} to activate${parks.length ? "" : " (add a POTA activation to the operation)"}.` }
  }
  const next = (Math.floor(count / 10) + 1) * 10
  const toGo = next - count
  return { header, status: `Activated! ${count} contacts. ${name} celebrates in ${toGo} more ${plural(toGo, "contact", "contacts")}, at ${next}.` }
}
