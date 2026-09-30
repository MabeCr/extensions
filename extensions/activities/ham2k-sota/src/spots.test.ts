// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The epoch gate in front of SOTAwatch's spot list, through `fetchSpots`.
// SOTAwatch moves its epoch UUID only when a spot changes, so an unchanged
// epoch answers from the last list without asking for spots again. The traps
// are all in the gate's failure modes: a gate that never reopens freezes the
// board, and so does one that accepts something other than a UUID as an
// epoch — a captive portal's page is constant, so every later poll matches it
// and short-circuits, with nothing throwing. And the epoch request is only an
// optimisation: its failure must cost the saving, never the spots.
//
// The last epoch is module state, so every test uses epochs of its own: a
// test whose first epoch matched the one another test left behind would be
// answered from that test's cache.

import { randomUUID } from "node:crypto"
import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const SPOTS = JSON.stringify([
  {
    id: 1,
    timeStamp: "2026-08-05T21:46:18.348572Z",
    comments: "",
    callsign: "N0SPOT",
    summitCode: "W7O/WV-096",
    summitName: "Sylvania, Mount",
    activatorCallsign: "KK7ER",
    activatorName: "Michael",
    frequency: 14.062,
    mode: "cw",
    points: 1,
    AltM: 297,
    AltFt: 975,
    type: null,
    epoch: "ed0601ac-a1f9-4666-98ba-2b0e52c07f5e",
  },
])

type EpochAnswer = { status: number; body: string } | Error

let epochs: EpochAnswer[] = []
let spotsRequests = 0

const sota = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    fetch: (params) => {
      const url = String(params.url)
      if (url.endsWith("/epoch")) {
        // The next answer, repeating the last once the list runs out.
        const answer = epochs.length > 1 ? epochs.shift()! : epochs[0]
        if (answer instanceof Error) throw answer
        return answer
      }
      spotsRequests += 1
      return { status: 200, body: SPOTS }
    },
  },
})

function serve(...answers: EpochAnswer[]) {
  epochs = answers
  spotsRequests = 0
}

const fetchSpots = async () => (await sota.runHook("spots", "fetchSpots", {}, { ctx: { online: true } })) as unknown[]

const ok = (body: string) => ({ status: 200, body })

test("an unchanged epoch answers from the last list without asking for spots again", async () => {
  // The spots service polls every two minutes while an operation is open, and
  // most polls find nothing new.
  const epoch = randomUUID()
  serve(ok(epoch), ok(epoch))
  const first = await fetchSpots()
  const second = await fetchSpots()
  assert.equal(first.length, 1)
  // The cached list, not an empty one.
  assert.deepEqual(second, first)
  assert.equal(spotsRequests, 1)
})

test("a moved epoch fetches the spots again", async () => {
  serve(ok(randomUUID()), ok(randomUUID()))
  await fetchSpots()
  await fetchSpots()
  assert.equal(spotsRequests, 2)
})

test("an epoch the server refuses costs the saving, not the spots", async () => {
  // A 503's body is not an epoch.
  serve({ status: 503, body: "nope" })
  assert.equal((await fetchSpots()).length, 1)
  assert.equal(spotsRequests, 1)
})

test("a 200 that is not a UUID never becomes the epoch", async () => {
  serve(ok("<html>Sign in to continue</html>"))
  await fetchSpots()
  const second = await fetchSpots()
  assert.equal(second.length, 1)
  assert.equal(spotsRequests, 2)
})

test("an epoch request that throws costs the saving, not the spots", async () => {
  // The host rethrows a reset connection; uncaught here, it would empty the
  // board for the cycle while the spots endpoint answers fine.
  serve(new Error("connection reset"))
  assert.equal((await fetchSpots()).length, 1)
})
