// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// For tests: the app's side of the two datasets. The app downloads each file, turns every entry into a row with the dataset's own mapper,
// and answers lookups from the rows; this does the same from the fixtures, so that what the panel reads is what the mappers made.

import type { DataFileDefinition } from "@ham2k/extension-sdk"

import { LIST_CATEGORY, ORBITS_CATEGORY } from "./data.ts"
import { listFile, orbitsFile } from "./datasets.ts"
import { ELEMENTS, LIST } from "./fixtures.ts"

/// What the app has downloaded: the entries of each file, or null for one it has not got yet.
export interface Downloaded {
  list: unknown[] | null
  orbits: unknown[] | null
}

export const downloaded = (): Downloaded => ({ list: LIST, orbits: ELEMENTS })

interface Row {
  category: string
  key: string
  name?: string
  data?: unknown
}

const rowsOf = (category: string, def: DataFileDefinition, entries: unknown[] | null): Row[] =>
  (entries ?? []).flatMap((entry) => {
    const made = def.jsonToLookupEntry!(entry as Record<string, any>)
    return made ? [{ category, key: made.key, name: made.name, data: JSON.parse(JSON.stringify(made.data ?? null)) }] : []
  })

/// The host's lookups, over `files`, which a test may change while it runs, and the calls made, in order.
export function datasetCalls(files: Downloaded = downloaded()) {
  const calls: string[] = []
  const all = (): Row[] => [...rowsOf(LIST_CATEGORY, listFile, files.list), ...rowsOf(ORBITS_CATEGORY, orbitsFile, files.orbits)]
  return {
    calls,
    files,
    hostCalls: {
      // As the app does: a hundred rows at the most, those whose key or name has the query in it.
      dbLookupSelectAll: (params: Record<string, unknown>) => {
        calls.push(`all ${String(params.category)}`)
        const q = String(params.query ?? "").toLowerCase()
        return all()
          .filter((r) => r.category === params.category && (r.key.toLowerCase().includes(q) || (r.name ?? "").toLowerCase().includes(q)))
          .slice(0, 100)
      },
      dbLookupSelectOne: (params: Record<string, unknown>) => {
        calls.push(`one ${String(params.category)} ${String(params.key)}`)
        return all().find((r) => r.category === params.category && r.key === params.key) ?? null
      },
    },
  }
}
