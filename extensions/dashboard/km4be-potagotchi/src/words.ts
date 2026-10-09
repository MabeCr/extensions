// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// What is written under the picture: the creature's name and the park, and how it is getting on.

import { ACTIVATION } from "./behavior.ts"
import type { Words } from "./scene.ts"

export const NAMES = ["Pip", "Moss", "Biscuit", "Fern", "Juniper", "Clover", "Maple", "Nugget", "Sprout", "Pebble", "Willow", "Bramble", "Acorn", "Thistle", "Mallow", "Tumble"]

/// A name for the creature that is the same every time for the same operation, and different for different ones.
export function nameFor(uuid: string): string {
  let hash = 0
  for (const ch of uuid) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return NAMES[hash % NAMES.length]
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/// How it feels, by how far along the first ten it is.
function mood(count: number): string {
  if (count === 0) return "hungry"
  if (count <= 3) return "nibbling"
  if (count <= 6) return "growing"
  return "almost there"
}

export function words(uuid: string, count: number, parks: string[]): Words {
  const name = nameFor(uuid)
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
