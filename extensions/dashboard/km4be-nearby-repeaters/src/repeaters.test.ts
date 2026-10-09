// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { escapeMarkdown, repeatersMarkdown } from "./markdown.ts"
import { distanceKm, parseCsv, parseRepeaters, rankRepeaters } from "./repeaters.ts"

const csv = `Frequency,Offset,Uplink Tone,Call,Location,Lat,Long
146.940,-0.600,100.0,W4AA,"Richmond, VA",37.54,-77.43
147.000,+0.600,88.5,W4BB,Norfolk,36.85,-76.29
146.520,0,,,Simplex,,
`

test("parseCsv handles quotes and CRLF", () => {
  assert.deepEqual(parseCsv('a,"b,c"\r\n"d""e",f\r\n'), [["a", "b,c"], ['d"e', "f"]])
})

test("parseRepeaters reads columns by header alias", () => {
  const [a, b, c] = parseRepeaters(csv)
  assert.equal(a.freq, 146.94)
  assert.equal(a.offset, -0.6)
  assert.equal(a.tone, 100)
  assert.equal(a.place, "Richmond, VA")
  assert.equal(b.offset, 0.6)
  assert.equal(c.lat, undefined)
})

test("CHIRP duplex column sets the offset direction", () => {
  const [r] = parseRepeaters("Frequency,Duplex,Offset,rToneFreq\n146.94,-,0.6,100.0\n")
  assert.equal(r.offset, -0.6)
  assert.equal(r.tone, 100)
})

test("no frequency column means no repeaters", () => {
  assert.deepEqual(parseRepeaters("Name,Lat\nx,1\n"), [])
})

test("distance and ranking", () => {
  assert.ok(Math.abs(distanceKm(37.54, -77.43, 36.85, -76.29) - 130) < 10)
  const ranked = rankRepeaters(parseRepeaters(csv), { lat: 36.9, lon: -76.3 }, 10)
  assert.deepEqual(ranked.map((r) => r.call), ["W4BB", "W4AA", ""])
  assert.equal(rankRepeaters(parseRepeaters(csv), null, 2).length, 2)
})

test("markdown escapes list text and always shows simplex", () => {
  assert.equal(escapeMarkdown("a|b*"), "a\\|b\\*")
  const md = repeatersMarkdown(rankRepeaters(parseRepeaters(csv), null, 10), 3, false)
  assert.match(md, /146\.940 \| −0\.6 \| 100/)
  assert.match(md, /146\.520 — 2m FM calling/)
  assert.match(repeatersMarkdown([], 0, false), /No repeaters yet/)
})
