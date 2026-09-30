// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// MOTA through its `scoring` HOOK. The award has duplicate rules but no
// activation threshold, so the trap is the shared scorer inventing one: a
// "3/10" under a mill that no rule asks ten contacts of is worse than showing
// no tally at all.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const mota = await loadExtension(() => import("./index.ts"))

test("reports no activation tally at all", async () => {
  const ref = { type: "motaActivation", ref: "X00001" }
  const result = (await mota.runHook("scoring", "scoreQsos", {
    operation: { uuid: "op", refs: [ref] },
    qsos: [{ uuid: "q0", their: { call: "W1AW" }, band: "20m", mode: "SSB", startAtMillis: Date.UTC(2026, 6, 1, 12) }],
    ref,
  })) as { operationSummary: Record<string, unknown> }
  assert.equal(result.operationSummary.activation, undefined)
})
