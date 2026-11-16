// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The extension through its hooks: that it is an activity an operator can
// add, that only an operation carrying it streams, that saving never changes
// the contact, and how the account check reads Club Log's answers.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"

import { loadExtension } from "./sdkGapTesting.ts"

let usage: { status: number; body: string } = { status: 200, body: "{}" }
let operatorCall = ""
const fetched: { url: string; headers?: Record<string, string> }[] = []

const ext = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    getSettings: () => ({ operatorCall }),
    fetch: (params) => {
      fetched.push(params as { url: string; headers?: Record<string, string> })
      return usage
    },
  },
})

const streaming = { uuid: "op-1", stationCall: "KI2D", refs: [{ type: "clublogLivestream" }] }
const plain = { uuid: "op-2", stationCall: "KI2D", refs: [{ type: "potaActivation", ref: "US-1234" }] }
const qso = { their: { call: "W1AW" }, startAtMillis: Date.UTC(2026, 10, 4, 14), band: "20m", mode: "CW" }

function context(token: string | undefined, reads: string[]): Partial<HookContext> {
  return {
    online: true,
    account: token ? { credentials: { token } } : undefined,
    getQsos: async (uuid: string) => {
      reads.push(uuid)
      return []
    },
  }
}

test("it is offered as an activity, by its words, until the operation has it", async () => {
  const offered = (await ext.runHook("activity", "suggest", { operation: plain, searchTerm: "club log" })) as { type: string }[]
  assert.deepEqual(offered.map((ref) => ref.type), ["clublogLivestream"])
  assert.deepEqual(await ext.runHook("activity", "suggest", { operation: plain, searchTerm: "pota" }), [])
  assert.deepEqual(await ext.runHook("activity", "suggest", { operation: streaming, searchTerm: "club" }), [])
})

test("only an operation with the activity is streamed, and the contact is saved untouched", async () => {
  const reads: string[] = []
  const ctx = context("cl_abc", reads)
  assert.equal(await ext.runHook("activity", "processQsoBeforeSave", { qso, operation: plain }, { ctx }), null)
  assert.deepEqual(reads, [], "an operation without the activity costs no read of its log")

  assert.equal(await ext.runHook("activity", "processQsoBeforeSave", { qso, operation: streaming }, { ctx }), null)
  assert.deepEqual(reads, ["op-1"])
})

test("without a token nothing is read or queued", async () => {
  const reads: string[] = []
  assert.equal(await ext.runHook("activity", "processQsoBeforeSave", { qso, operation: streaming }, { ctx: context(undefined, reads) }), null)
  assert.deepEqual(reads, [])
})

test("the account check sends the token as a bearer and reads a 401 as a refused token", async () => {
  fetched.length = 0
  operatorCall = ""
  usage = { status: 200, body: JSON.stringify({ minute: { used: 1, limit: 60 } }) }
  const accepted = await ext.runHook("account", "testCredentials", { token: " cl_abc " })
  assert.equal(accepted, "Connected to Club Log")
  assert.equal(fetched[0].url, "https://clublog.org/api/v1/me/usage")
  assert.equal(fetched[0].headers?.Authorization, "Bearer cl_abc")

  usage = { status: 401, body: JSON.stringify({ error: { code: "unauthorized", message: "unknown token" } }) }
  await assert.rejects(ext.runHook("account", "testCredentials", { token: "cl_bad" }) as Promise<JSONValue>)
  await assert.rejects(ext.runHook("account", "testCredentials", { token: "" }) as Promise<JSONValue>)
})

// "Connected as" is only said after Club Log answered for that call's own
// log: a check that just named the profile's call would claim an account it
// never asked about.
test("with an operator call, the check asks for that call's log and says whether the account holds it", async () => {
  fetched.length = 0
  operatorCall = "ki2d"
  usage = { status: 200, body: JSON.stringify({ qsos: [] }) }
  assert.equal(await ext.runHook("account", "testCredentials", { token: "cl_abc" }), "Connected as KI2D")
  assert.equal(fetched[0].url, "https://clublog.org/api/v1/logs/KI2D/qsos?limit=1")

  usage = { status: 403, body: JSON.stringify({ error: { code: "forbidden", message: "not your callsign" } }) }
  const notHeld = (await ext.runHook("account", "testCredentials", { token: "cl_abc" })) as string
  assert.match(notHeld, /does not hold KI2D/)

  usage = { status: 401, body: JSON.stringify({ error: { code: "unauthorized", message: "unknown token" } }) }
  await assert.rejects(ext.runHook("account", "testCredentials", { token: "cl_bad" }) as Promise<JSONValue>)
  operatorCall = ""
})
