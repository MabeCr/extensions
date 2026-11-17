// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// How each letter of a call differs from what was typed: what the panel
// colours them by.

import { test } from "node:test"
import assert from "node:assert/strict"

import { compareLetters, letterRuns } from "./letters.ts"

const marked = (typed: string, call: string) => compareLetters(typed, call).map(({ char, kind }) => (kind === "same" ? char : `${kind}:${char}`))

test("a call the text appears inside adds the letters around it", () => {
  assert.deepEqual(marked("K1A", "WK1AB"), ["added:W", "K", "1", "A", "added:B"])
})

test("a call one letter off has that letter changed, added or left out", () => {
  assert.deepEqual(marked("K1ABC", "K1ABD"), ["K", "1", "A", "B", "changed:D"])
  assert.deepEqual(marked("K1ABC", "K1ABCD"), ["K", "1", "A", "B", "C", "added:D"])
  assert.deepEqual(marked("K1ABC", "K1AC"), ["K", "1", "A", "removed:B", "C"], "the letter left out is shown where it was typed")
})

// `findCalls` offers two traded neighbors as one edit away; both letters
// must show, or the call would look like the one typed.
test("two neighbors that traded places are both marked", () => {
  assert.deepEqual(marked("K1ABC", "K1BAC"), ["K", "1", "changed:B", "changed:A", "C"])
})

test("a ? typed stands for any letter, and the one it stands for is added", () => {
  assert.deepEqual(marked("K1?BC", "K1ABC"), ["K", "1", "added:A", "B", "C"])
})

test("the whole call typed is all its own letters", () => {
  assert.deepEqual(marked("k1abc", "K1ABC"), ["K", "1", "A", "B", "C"])
})

test("letters of one kind run together, each run knowing where it starts", () => {
  assert.deepEqual(letterRuns(compareLetters("K1A", "WK1AB")), [
    { kind: "added", text: "W", start: 0 },
    { kind: "same", text: "K1A", start: 1 },
    { kind: "added", text: "B", start: 4 },
  ])
})

// A letter left out is drawn as a mark between its neighbors, not as a
// letter: the call after it must not shift a column.
test("a letter left out takes no column, so the letters after it stay where the call puts them", () => {
  assert.deepEqual(letterRuns(compareLetters("K1ABC", "K1AC")), [
    { kind: "same", text: "K1A", start: 0 },
    { kind: "removed", text: "B", start: 3 },
    { kind: "same", text: "C", start: 3 },
  ])
})

test("a character past U+FFFF is one letter, never split in two", () => {
  assert.deepEqual(marked("K1A", "K1A😀"), ["K", "1", "A", "added:😀"])
})
