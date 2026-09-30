// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The activation tally's wording, through the `scoring` hook. The nouns and
// the summit-to-summit label resolve through this extension's own i18n keys,
// and a mistyped key does not throw — it falls back to the raw key string, so
// the scoreboard reads "summitsPlural" and nothing fails.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const sota = await loadExtension(() => import("./index.ts"))

test("an activation's label reads in words, and names summit-to-summit contacts S2S", async () => {
  const operation = { uuid: "op", stationCall: "N0DEV", refs: [{ type: "sotaActivation", ref: "W1/AM-001" }] }
  const qsos = Array.from({ length: 4 }, (_, i) => ({
    uuid: `q${i}`,
    startAtMillis: Date.UTC(2026, 6, 1, 12, i),
    band: "20m",
    mode: "SSB",
    our: { call: "N0DEV" },
    their: { call: `W${i}ABC` },
    refs: [{ type: "sota", ref: "W1/AM-002" }],
  }))
  const result = (await sota.runHook("scoring", "scoreQsos", { operation, qsos, ref: operation.refs[0] })) as {
    operationSummary: { activation: { label: string } }
  }
  const label = result.operationSummary.activation.label
  assert.ok(label.includes("activation QSO"), label)
  assert.ok(label.includes("S2S"), label)
})
