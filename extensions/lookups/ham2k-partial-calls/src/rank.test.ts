// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The order the calls are offered in is the whole of what the operator sees
// of the ranking: the first call is the one Alt-Y puts in the field.

import { test } from "node:test"
import assert from "node:assert/strict"

import { isContestRef, rankCandidates, scpModeBit } from "./rank.ts"
import type { Sources } from "./rank.ts"

const NOW = Date.UTC(2026, 10, 13)
const found = (call: string, match: "exact" | "partial" | "oneEdit", count = 1, lastAtMillis: number | null = NOW) => ({ call, match, count, lastAtMillis })
const scp = (key: string, match: "exact" | "partial" | "oneEdit", data: Record<string, number>) => ({ key, match, data })
const none: Sources = { operation: [], contest: [], logs: [], scp: [] }
const calls = (sources: Partial<Sources>, context: { mode?: string; contestRefTypes?: string[] } = {}) =>
  rankCandidates({ ...none, ...sources }, { contestRefTypes: [], nowMillis: NOW, ...context }).map((c) => c.call)

test("a call worked in this operation comes before one worked in the contest before, then one in any log, then one only SCP knows", () => {
  assert.deepEqual(
    calls({
      scp: [scp("K1ABD", "partial", { rate: 80000 })],
      logs: [found("K1ABC", "partial", 40)],
      contest: [found("K1ABE", "partial")],
      operation: [found("K1ABF", "partial")],
    }),
    ["K1ABF", "K1ABE", "K1ABC", "K1ABD"],
  )
})

test("within a source, the whole call typed comes before a call it appears in, and that before one a typo away", () => {
  assert.deepEqual(calls({ logs: [found("K1ABC", "oneEdit"), found("WK1AB", "partial"), found("K1AB", "exact")] }), ["K1AB", "WK1AB", "K1ABC"])
})

test("a call in several sources ranks above one in the strongest of them alone, and keeps its closest match", () => {
  const ranked = rankCandidates(
    { ...none, logs: [found("K1ABC", "partial"), found("K1ABD", "partial")], scp: [scp("K1ABD", "partial", { rate: 10 })] },
    { contestRefTypes: [], nowMillis: NOW },
  )
  assert.deepEqual(
    ranked.map((c) => [c.call, c.match]),
    [
      ["K1ABD", "partial"],
      ["K1ABC", "partial"],
    ],
  )
})

test("of SCP's calls, one heard on this mode and in this contest comes before a busier one heard on neither", () => {
  const sources = { scp: [scp("K1ABC", "partial", { rate: 2000, modes: 2, contests: 1024 }), scp("K1ABD", "partial", { rate: 800, modes: 1, contests: 1 })] }
  assert.deepEqual(calls(sources), ["K1ABC", "K1ABD"], "without a mode or a contest, the busier first")
  assert.deepEqual(calls(sources, { mode: "CW", contestRefTypes: ["cqww"] }), ["K1ABD", "K1ABC"])
})

test("SCP's mode bits: phone is one bit whatever the sideband, and any data mode is digital", () => {
  assert.deepEqual(["CW", "USB", "SSB", "FM", "RTTY", "FT8", undefined].map(scpModeBit), [1, 2, 2, 4, 8, 16, null])
})

test("a ref the app marks is a contest's; unmarked, anything but an activation is taken for one", () => {
  assert.equal(isContestRef({ type: "potaActivation", contest: true }), true)
  assert.equal(isContestRef({ type: "cqww" }), true)
  assert.equal(isContestRef({ type: "potaActivation", ref: "US-0001" }), false)
  assert.equal(isContestRef({}), false)
})
