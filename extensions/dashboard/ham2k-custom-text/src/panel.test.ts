// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The Custom Text pane through its `panel` HOOK: what it advertises and what
// one render hands back. The traps are in the render's contract — the count
// reaches the text only through the render args, `app.name` only through
// `ctx.appName`, and `triggers` has to be derived from what the operator
// wrote, because no descriptor can say what a pane's own template reads.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

interface Descriptor {
  key: string
  title: string
  description: string
  preview: string
  multiple: boolean
  form: { key?: string }[]
}

interface Content {
  kind: string
  title: string
  content: string
  triggers: string[]
}

const panel = await loadExtension(() => import("./index.ts"))

const render = async (config: Record<string, string>) =>
  (await panel.runHook(
    "panel",
    "render",
    { panelKey: "text", operation: { uuid: "op-1", stationCall: "N0DEV" }, qsoCount: 7, config, reason: "initial" },
    { ctx: { appName: "Ham2K Logger" } },
  )) as Content

test("advertises one panel that can be placed more than once, configured by a title and a text", async () => {
  // `multiple: false` would let an operator place exactly one — the sked list
  // or the band plan, never both. A form missing either key leaves the pane
  // untitled or unwritable.
  const panels = (await panel.runHook("panel", "getPanels", {})) as Descriptor[]
  assert.equal(panels.length, 1)
  const [text] = panels
  assert.equal(text.key, "text")
  assert.ok(text.title)
  assert.ok(text.description)
  // The preview carries its own pixels; a URL or a name draws nothing.
  assert.ok(text.preview.startsWith("<svg"))
  assert.equal(text.multiple, true)
  const keys = text.form.map((e) => e.key)
  assert.ok(keys.includes("title"))
  assert.ok(keys.includes("content"))
})

test("renders the operator's text with the log's count and the app's name, titled as configured", async () => {
  const content = await render({ title: "Sked list", content: "Worked {{ op.qsoCount }} so far in {{ app.name }}" })
  assert.equal(content.kind, "markdown")
  // Several placements are told apart only by this; without it every tab
  // reads "Custom Text".
  assert.equal(content.title, "Sked list")
  // 7 exists only in the render args, and the app's name only in the hook
  // context — a template context built from anything else renders blanks.
  assert.ok(content.content.includes("Worked 7 so far in Ham2K Logger"), content.content)
  // `op.qsoCount` is what asks to re-render on a new QSO and an operation
  // change; a pane that declared nothing would show 7 forever.
  assert.ok(content.triggers.includes("qsoLogged"))
  assert.ok(content.triggers.includes("operation"))
})

test("a text that names nothing live asks to be re-rendered by nothing", async () => {
  // A static band plan re-rendered on every keystroke because the pane beside
  // it names the callsign being typed is the cost per-render triggers avoid.
  const content = await render({ title: "Band plan", content: "20m: 14.000-14.350" })
  assert.deepEqual(content.triggers, [])
})
