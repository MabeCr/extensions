// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCatalog, ELEMENTS_URL, LIST_URL, parseElements, parseList, statusUrl } from "./data.ts"
import { datasetCalls } from "./datasetTesting.ts"
import { ELEMENTS, LIST, SUMMARY } from "./fixtures.ts"
import { findPlace } from "./location.ts"
import { forgetAll } from "./memory.ts"
import { nextPasses } from "./passes.ts"
import { loadExtension } from "./sdkGapTesting.ts"

const ctx = { online: true }
const t0 = Date.parse("2026-10-07T00:00:00Z")

test("with alerts switched on, a draw puts the next pass on the FYI line and keeps the choice; switched off, it is taken down", async () => {
  forgetAll()
  const posted: { key: string; text: string; category: string }[] = []
  const cleared: string[] = []
  const saved: Record<string, unknown>[] = []
  const marked: { key: string; label: string; fromHz: number }[] = []
  const unmarked: string[] = []
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      ...datasetCalls().hostCalls,
      getLocation: () => null,
      kvGet: () => null,
      kvSet: () => undefined,
      fyiPost: (params) => void posted.push(params as never),
      fyiClear: (params) => void cleared.push(String((params as { key: string }).key)),
      putBandAnnotations: (params) => void marked.push(...(params as { annotations: never[] }).annotations),
      removeBandAnnotations: (params) => void unmarked.push(...((params as { keys?: string[] }).keys ?? [])),
      setSettings: (params) => void saved.push((params as { values: Record<string, unknown> }).values),
      fetch: (params) => {
        const url = String(params.url)
        return url === LIST_URL
          ? { status: 200, body: JSON.stringify(LIST) }
          : url === ELEMENTS_URL
            ? { status: 200, body: JSON.stringify(ELEMENTS) }
            : url === statusUrl(24)
              ? { status: 200, body: JSON.stringify(SUMMARY) }
              : { status: 404, body: "" }
      },
    },
  })
  const place = (await findPlace({ grid: "EL95vs" }, undefined, t0))!
  const next = nextPasses(buildCatalog(parseList(LIST), parseElements(ELEMENTS), {}), place, t0 + 3_600_000, 10)[0]
  const at = next.aos - 60_000
  const render = (config: Record<string, unknown>) =>
    ext.runHook("panel", "render", { panelKey: "passes", instanceId: "alerts", operation: {}, qsoCount: 0, reason: "", config, clock: { nowMillis: at, realNowMillis: at } }, { ctx })

  await render({ grid: "EL95vs", alerts: true, bandLabels: true })
  // The alert is posted from the draw, and the timer's readings are not awaited: give them a moment.
  for (let i = 0; i < 50 && !posted.length; i++) await new Promise((r) => setImmediate(r))
  assert.ok(posted.some((p) => p.key === `pass-${next.satellite.name}` && p.text.startsWith(`**${next.satellite.name}** rises in 1 min`)), JSON.stringify(posted))
  assert.ok(saved.some((s) => (s.alerts as { on?: boolean } | undefined)?.on === true), "the choice is kept for the next launch")
  for (let i = 0; i < 50 && !marked.length; i++) await new Promise((r) => setImmediate(r))
  assert.ok(marked.some((m) => m.key === `sat-${next.satellite.name}-down` && m.label === `${next.satellite.name} ↓`), JSON.stringify(marked))

  await render({ grid: "EL95vs", alerts: false })
  for (let i = 0; i < 50 && !cleared.length; i++) await new Promise((r) => setImmediate(r))
  assert.deepEqual(cleared, [`pass-${next.satellite.name}`])
  for (let i = 0; i < 50 && !unmarked.length; i++) await new Promise((r) => setImmediate(r))
  assert.ok(unmarked.includes(`sat-${next.satellite.name}-down`), "and its marks come off the band scope")
  assert.ok(saved.some((s) => (s.alerts as { on?: boolean } | undefined)?.on === false))
})
