// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// BLHA's activity search, through its HOOK. A BLHA reference has a space in it
// (`BEL 123`), and the search's "does this look like a reference" heuristic
// rejects whitespace. The trap is a lighthouse the list lacks becoming
// impossible to add: the scoped search is the only way in for one.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const blha = await loadExtension(() => import("./index.ts"))

test("a reference the pattern accepts is offered whatever it looks like", async () => {
  // Lookups answer nothing, so the typed reference is the only thing that can
  // come back.
  const suggestions = (await blha.runHook("activity", "suggest", {
    operation: { uuid: "op" },
    searchTerm: "BEL 999",
    scoped: true,
  })) as { ref: string }[]
  assert.equal(suggestions[0]?.ref, "BEL 999")
})
