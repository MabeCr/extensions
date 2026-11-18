// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCatalog, parseElements, parseList } from "./data.ts"
import { buildDetail } from "./detail.ts"
import { ELEMENTS, LIST } from "./fixtures.ts"
import { findPasses, satrecFromOmm } from "./orbit.ts"
import { buildDetailScene, detailStrings } from "./scene.ts"
import { proseOf, roomOf, textWidth } from "./wrap.ts"

const room = roomOf(300, { size: 13, os: 1 }, 13, 14, { label: 18, body: 20 })!
const caption = "Solid while it is above your horizon, from the green dot to the red. The ringed dot is where it is now, and the shaded circle is where it can be heard from."

test("a short text is one control bound to its string, as it always was", () => {
  const p = proseOf("fillLine", "Contacts are not tagged.", "Contacts", "label", room)
  assert.deepEqual(p.controls, [{ id: "fillLine", kind: "nativeText", label: "Contacts", value: "fillLine", style: "label" }])
  assert.deepEqual(p.node, { control: "fillLine" })
  assert.equal(p.height, room.textLine)
})

test("a text that might not fit is a run of words in a wrap, which the app breaks, and nothing is left for it to cut", () => {
  const p = proseOf("mapKey", caption, "What the map shows", "label", room)
  const words = caption.split(" ")
  assert.equal(p.controls.length, words.length)
  assert.deepEqual(p.controls.map((c) => c.label), words)
  assert.ok(p.controls.every((c) => c.kind === "nativeText" && c.style === "label" && c.value === undefined), "a word is its own label")
  assert.ok("wrap" in p.node && p.node.wrap.length === words.length)
  assert.ok(p.node.wrap.every((n, i) => "control" in n && n.control === p.controls[i].id))
  // The height, for a page on a grid, is for more lines than there will be, not fewer.
  const lines = Math.ceil((textWidth(caption, 14) * 1.3) / 300)
  assert.ok(p.height >= lines * room.textLine && lines >= 3)
})

test("a monospaced line breaks the same way, with a character's width between its words", () => {
  const p = proseOf("radio4", "Arm first: a 2 s carrier at 74.4 Hz starts a 10 min timer.", "Radio line 5", "mono", room)
  assert.ok("wrap" in p.node && p.node.spacing === Math.round(room.monoChar))
  assert.ok(p.controls.every((c) => c.style === "mono"))
})

test("without a report of the pane, or with one word, there is nothing to wrap", () => {
  assert.equal(proseOf("k", caption, "L", "label", undefined).controls.length, 1)
  assert.equal(proseOf("k", "x".repeat(200), "L", "label", room).controls.length, 1)
  assert.equal(roomOf(0, { size: 13, os: 1 }, 13, 14, { label: 18, body: 20 }), undefined)
})

const ao7 = buildCatalog(parseList(LIST), parseElements(ELEMENTS), {}).find((s) => s.name === "AO-7")!
const miami = { lat: 25.76, lon: -80.19 }
const pass = findPasses(satrecFromOmm(ao7.omm!), miami, Date.parse("2026-10-07T00:00:00Z"), 24, 10)[0]

test("on the Radio page the strings are whole and the long ones are laid out as words", () => {
  const detail = buildDetail({ ...ao7, info: { ...ao7.info, tips: "Switch to the beacon first and listen for the telemetry before you try the transponder." } }, miami, pass, pass.aos, true, "radio")
  detail.status = ["Heard by 12 operators in the last 24 hours, the latest 35 minutes ago, with no reports of trouble."]
  detail.columns = roomOf(200, { size: 13, os: 1 }, 13, 14, { label: 18, body: 20 })
  const strings = detailStrings(detail)
  assert.equal(strings.status0, detail.status[0], "the string is the whole text")
  const scene = buildDetailScene(detail)
  assert.ok(scene.controls!.some((c) => /^status0_\d+$/.test(c.id)), "its words are controls")
  assert.ok(scene.controls!.some((c) => /^radio\d+_\d+$/.test(c.id)), "so are the long radio lines'")
  assert.equal(strings.title, detailStrings({ ...detail, columns: undefined }).title)
})
