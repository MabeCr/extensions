// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The assistant through its hooks, against a stand-in host: what it asks
// the logs and SCP, and what it posts under the call info.

import { test } from "node:test"
import assert from "node:assert/strict"

import { fixtureOperation, loadExtension } from "./sdkGapTesting.ts"

const posts: Record<string, unknown>[] = []
const clears: Record<string, unknown>[] = []
let scpAsked = 0
const logsAsked: Record<string, unknown>[] = []

const partialCalls = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    dbLookupFindCalls: (params) => {
      scpAsked++
      if (params.call === "K1AF") throw new Error("SCP.DB is damaged")
      return params.call === "K1A" ? [{ key: "K1ABD", match: "partial", data: { rate: 900, modes: 1, contests: 1 } }] : []
    },
    draftSuggestionsPost: (params) => {
      posts.push(params)
      return { accepted: true }
    },
    draftSuggestionsClear: (params) => {
      clears.push(params)
      return null
    },
  },
})

const contest = fixtureOperation({ uuid: "op-contest", refs: [{ type: "cqww", contest: true }] })
const park = fixtureOperation({ uuid: "op-park", refs: [{ type: "potaActivation", ref: "US-0001" }] })

const ctx = {
  findCalls: async (call: string, options: Record<string, unknown>) => {
    logsAsked.push(options)
    if (!call.startsWith("K1A")) return []
    if (options.operation) return [{ call: "K1ABC", match: "partial", count: 1, lastAtMillis: 1 }]
    return [{ call: "K1AA", match: "oneEdit", count: 3, lastAtMillis: 1 }]
  },
  scoreCandidates: async (candidates: Record<string, unknown>) => ({
    ...Object.fromEntries(Object.keys(candidates).map((call) => [call, { notices: [], alerts: [] }])),
    K1ABC: { notices: ["duplicate"], alerts: [] },
  }),
}

const observe = (operation: Record<string, unknown>, call: string, config: Record<string, unknown> = {}) =>
  partialCalls.runHook(
    "assistant",
    "observe",
    { assistantKey: "suggest", operation, qso: { their: { call }, mode: "CW", band: "20m" }, qsoCount: 0, config, reasons: ["qso"], clock: { nowMillis: 2, realNowMillis: 2 } },
    { ctx: ctx as never },
  )

test("in a contest, the calls the text could be are offered, likeliest first, with what the scorers say of each", async () => {
  posts.length = 0
  await observe(contest, "k1a")
  assert.deepEqual(posts, [
    {
      forCall: "K1A",
      operationUuid: "op-contest",
      drafts: [
        { qso: { their: { call: "K1ABC" } }, notices: ["duplicate"], alerts: [] },
        { qso: { their: { call: "K1AA" } }, notices: [], alerts: [] },
        { qso: { their: { call: "K1ABD" } }, notices: [], alerts: [] },
      ],
    },
  ])
})

// A call typed out in full is in the last list too; left without a list of
// its own, the line goes just as the call is complete, its verdicts with it.
test("a call typed out in full gets a list of its own, though the last list held it", async () => {
  posts.length = 0
  await observe(contest, "K1A")
  await observe(contest, "K1AA")
  assert.deepEqual(
    posts.map((post) => post.forCall),
    ["K1A", "K1AA"],
  )
})

test("outside a contest nothing is offered, unless Only for Contests is turned off", async () => {
  posts.length = 0
  await observe(park, "K1A")
  assert.equal(posts.length, 0)
  await partialCalls.runHook("settingsPanel", "onChangeField", { panelKey: "ham2k-partial-calls", fieldKey: "onlyContests", value: false })
  await observe(park, "K1A")
  assert.equal(posts.length, 1)
  await partialCalls.runHook("settingsPanel", "onChangeField", { panelKey: "ham2k-partial-calls", fieldKey: "onlyContests", value: true })
})

test("under three characters, the list offered is taken back, and nothing is asked", async () => {
  clears.length = 0
  const asked = scpAsked
  await observe(contest, "K1")
  assert.deepEqual(clears, [{ operationUuid: "op-contest" }])
  assert.equal(scpAsked, asked)
})

test("Super Check Partial is a sqlite data file read straight into the lookups, keyed by call", async () => {
  const definition = partialCalls.hooks.find((h) => h.category === "dataFile")?.hook
  assert.equal(definition?.fetchType, "sqlite")
  assert.equal(definition?.url, "https://www.supercheckpartial.com/SCP.DB")
  assert.deepEqual(definition?.fields, { key: "callsign" })
})

// Each switch takes its own source out and leaves the others: a mix-up between
// "this operation" and "every other log" passes any test that turns both off.
test("searching this activity and searching your other logs are each switched off on their own", async () => {
  const change = (fieldKey: string, value: boolean) =>
    partialCalls.runHook("settingsPanel", "onChangeField", { panelKey: "ham2k-partial-calls", fieldKey, value })
  const asked = async () => {
    logsAsked.length = 0
    await observe(contest, "K1B")
    return logsAsked.map((options) => (options.operation ? "activity" : "logs"))
  }
  assert.deepEqual((await asked()).sort(), ["activity", "logs", "logs"], "this operation, its contest before, and every other log")

  await change("searchActivity", false)
  assert.deepEqual(await asked(), ["logs", "logs"])

  await change("searchActivity", true)
  await change("searchLogs", false)
  assert.deepEqual(await asked(), ["activity"])
  await change("searchLogs", true)
})

// All or nothing, a damaged SCP.DB would take the calls the logs found with
// it, and say nothing the operator could see.
test("a source that fails leaves the others' calls offered, and its error is still thrown", async () => {
  posts.length = 0
  // Named, so the count says which source broke, with its own error kept.
  await assert.rejects(observe(contest, "K1AF"), (error: Error) => /Super Check Partial/.test(error.message) && /SCP.DB is damaged/.test(String((error.cause as Error)?.message)))
  assert.deepEqual(
    posts.map((post) => post.forCall),
    ["K1AF"],
  )
})
