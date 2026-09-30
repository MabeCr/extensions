// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// PGA's reference link, through its `ref:` HOOK. The award publishes a gmina
// list and nothing addressable per gmina, so the trap is offering a link
// anyway — into a search form, or a page that does not exist.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const pga = await loadExtension(() => import("./index.ts"))

test("a program with no page per reference offers no link at all", async () => {
  // Silence is the answer: the row shows no link icon.
  assert.equal(await pga.runHook("ref:pgaActivation", "linkForRef", { ref: { type: "pgaActivation", ref: "AB12" } }), null)
})
