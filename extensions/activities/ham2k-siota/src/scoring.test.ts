// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The activation tally's wording, through the `scoring` HOOK. Each program's
// nouns and its peer-to-peer label resolve through its OWN i18n catalog, and a
// key missing from it falls back to the raw key string without throwing — so
// only rendering the summary catches a typo there.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const siota = await loadExtension(() => import("./index.ts"))

test("the activation label reads S2S, the summit-to-summit wording SiOTA shares with SOTA", async () => {
  const ref = { type: "siotaActivation", ref: "G-0001" }
  const qsos = Array.from({ length: 10 }, (_, i) => ({
    uuid: `q${i}`,
    startAtMillis: Date.UTC(2026, 6, 1, 12, i),
    band: "20m",
    mode: "SSB",
    our: { call: "N0DEV" },
    their: { call: `W${i}ABC` },
    refs: [{ type: "siota", ref: "G-0002" }],
  }))
  const result = (await siota.runHook("scoring", "scoreQsos", {
    operation: { uuid: "op", stationCall: "N0DEV", refs: [ref] },
    qsos,
    ref,
  })) as { operationSummary: { activation?: { label?: string } } }
  assert.match(result.operationSummary.activation?.label ?? "", /S2S/)
})
