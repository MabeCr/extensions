// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// How a call differs from what was typed, letter by letter: the cheapest
// way to turn one into the other, a letter added, left out or changed for
// another. Two neighbors that traded places come out as two changed
// letters, both marked, though `findCalls` counts them as one edit.

export type LetterKind = "same" | "added" | "removed" | "changed"

export interface Letter {
  char: string
  kind: LetterKind
}

/// [call]'s letters, in order, each marked against [typed]: `added` where
/// the call has a letter the text lacks (a `?` typed stands for any one
/// letter, and the one it stands for is added too), `changed` where one
/// replaced another, and the text's letters
/// the call lacks, `removed`, where they were typed.
///
/// Walked by character, never by UTF-16 unit, so a character past U+FFFF is
/// one letter.
export function compareLetters(typed: string, call: string): Letter[] {
  const a = [...typed.toUpperCase()]
  const b = [...call.toUpperCase()]
  const n = a.length
  const m = b.length
  const wild = (i: number) => a[i] === "?"
  // cost[i][j]: edits turning a's first i letters into b's first j.
  const cost: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = a[i - 1] === b[j - 1] || wild(i - 1)
      cost[i][j] = Math.min(cost[i - 1][j] + 1, cost[i][j - 1] + 1, cost[i - 1][j - 1] + (same ? 0 : 1))
    }
  }

  const letters: Letter[] = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && (a[i - 1] === b[j - 1] || wild(i - 1)) && cost[i][j] === cost[i - 1][j - 1]) {
      letters.push({ char: b[j - 1], kind: wild(i - 1) ? "added" : "same" })
      i--
      j--
    } else if (i > 0 && j > 0 && cost[i][j] === cost[i - 1][j - 1] + 1) {
      letters.push({ char: b[j - 1], kind: "changed" })
      i--
      j--
    } else if (j > 0 && cost[i][j] === cost[i][j - 1] + 1) {
      letters.push({ char: b[j - 1], kind: "added" })
      j--
    } else {
      letters.push({ char: a[i - 1], kind: "removed" })
      i--
    }
  }
  return letters.reverse()
}

/// [letters] joined into runs of one kind, each with the column it starts
/// at in the call as drawn: a letter left out takes no column, so a run of
/// them starts where the letters on either side meet.
export function letterRuns(letters: Letter[]): { kind: LetterKind; text: string; start: number }[] {
  const runs: { kind: LetterKind; text: string; start: number }[] = []
  let column = 0
  for (const letter of letters) {
    const last = runs[runs.length - 1]
    if (last && last.kind === letter.kind) last.text += letter.char
    else runs.push({ kind: letter.kind, text: letter.char, start: column })
    if (letter.kind !== "removed") column++
  }
  return runs
}
