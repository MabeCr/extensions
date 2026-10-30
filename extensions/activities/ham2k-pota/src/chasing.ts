// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// POTA hunting as a chasing program (the app's docs/design/claims.md): every
// park a contact hunted is a line of the hunter's checklist, on any band and
// in any mode. A hunted contact is only ever worked here — POTA confirms a
// hunt through its own records, which reach a contact as
// `qso.credits['ham2k-pota']` once imported. POTA's export of the parks an
// account has hunted is imported as the checklist's verified lines.

import { parseCallsign } from '@ham2k/lib-callsigns'
import { fmtInteger } from '@ham2k/lib-format-tools'
import type { ChasingHook, ClaimSlot, ClaimsTally, HookContext, ImportedClaim, JSONValue, QsoClaim } from '@ham2k/extension-sdk'

import { tFor } from './i18n.ts'
import { normalizeReference } from './refFormatting.ts'

/// The credits key is the program's key, which is the extension's.
const PROGRAM_KEY = 'ham2k-pota'

function obj(value: JSONValue | undefined): Record<string, JSONValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/// Hunter credit goes to the operator's call without its portable prefix or
/// suffix: KI2D, KI2D/P and VE2/KI2D hunt for one checklist.
function holderFor(call: string): string {
  const trimmed = call.trim().toUpperCase()
  return parseCallsign(trimmed).baseCall || trimmed
}

function claimsForQso(qso: Record<string, JSONValue>, huntingType: string): QsoClaim[] {
  if (qso.band === 'event' || qso.deleted === true) return []
  const ourCall = obj(qso.our).call
  if (typeof ourCall !== 'string' || !ourCall) return []
  const credit = obj(obj(qso.credits)[PROGRAM_KEY])
  const level = credit.level === 'verified' ? { level: 'verified' as const, by: typeof credit.by === 'string' ? credit.by : 'pota' } : { level: 'worked' as const }
  const refs = Array.isArray(qso.refs) ? qso.refs.map(obj) : []
  const parks = new Map<string, string | undefined>()
  for (const ref of refs) {
    if (ref.type !== huntingType || typeof ref.ref !== 'string' || !ref.ref) continue
    // One park typed two ways (`US1234`, `US-1234`) is one line of the
    // checklist, not two.
    const park = normalizeReference(ref.ref) ?? ref.ref.toUpperCase().trim()
    parks.set(park, typeof ref.name === 'string' && ref.name ? ref.name : undefined)
  }
  return [...parks].map(([park, name]) => ({ holder: holderFor(ourCall), ref: park, band: null, mode: null, ...level, ...(name ? { label: name } : {}) }))
}

function summarizeClaims({ slots }: { slots: ClaimSlot[] }, ctx: HookContext): Record<string, ClaimsTally> {
  const t = tFor(ctx)
  const count = slots.filter((slot) => slot.band === null && slot.mode === null).length
  return {
    hunted: {
      key: 'hunted',
      icon: 'pine-tree',
      label: count === 1 ? t('oneParkHunted') : t('manyParksHunted', { formatted: fmtInteger(count) }),
      total: count,
    },
  }
}

/// The rows of a CSV file, each a list of fields. Quoted fields may hold
/// commas, doubled quotes and line breaks — park names have all three.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((fields) => fields.some((value) => value.trim()))
}

export const HUNTED_PARKS_IMPORTER = 'hunted-parks'

/// POTA's "Hunted Parks" export (pota.app, My Stats): one park per row, with
/// the date of the account's first contact with it. Every park in it is one
/// POTA has credited, so it verifies the line. The account's own activated
/// parks come in a file with the same columns plus its activations, and are
/// no hunt: that file claims nothing.
function importHuntedParks(text: string, holder: string): { claims: ImportedClaim[]; skipped: number } {
  const [header = [], ...rows] = parseCsv(text.replace(/^\uFEFF/, ''))
  const column = (name: string) => header.findIndex((value) => value.trim().toLowerCase() === name)
  const refAt = column('reference')
  const nameAt = column('park name')
  const dateAt = column('first qso date')
  if (refAt < 0 || column('activations') >= 0) return { claims: [], skipped: rows.length }
  const claims: ImportedClaim[] = []
  let skipped = 0
  for (const fields of rows) {
    const park = normalizeReference(fields[refAt] ?? '')
    if (!park) {
      skipped++
      continue
    }
    const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec((fields[dateAt] ?? '').trim())
    const name = (fields[nameAt] ?? '').trim()
    claims.push({
      holder,
      ref: park,
      band: null,
      mode: null,
      level: 'verified',
      by: 'pota',
      ...(name ? { label: name } : {}),
      ...(date ? { at: Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])) } : {}),
    })
  }
  return { claims, skipped }
}

export function potaHunterProgram(huntingType: string): ChasingHook {
  return {
    program: {
      label: 'POTA Hunter',
      refLabel: 'POTA Park',
      icon: 'pine-tree',
      color: '#068541',
      version: 1,
      editions: 'lifetime',
      imports: [{ key: HUNTED_PARKS_IMPORTER, label: 'POTA Hunted Parks (CSV)', extensions: ['csv'] }],
    },
    // A contact without a uuid has no key to answer under, and is left out.
    claimsForQsos: ({ qsos }) =>
      Object.fromEntries(qsos.filter((qso) => typeof qso.uuid === 'string' && qso.uuid).map((qso) => [qso.uuid as string, claimsForQso(qso, huntingType)])),
    holdersFor: ({ station }) => (typeof station.call === 'string' && station.call ? [holderFor(station.call)] : []),
    summarizeClaims,
    importClaims: ({ importer, file, station }) => {
      const call = typeof station.call === 'string' ? station.call : ''
      if (importer !== HUNTED_PARKS_IMPORTER || !call) return { claims: [] }
      return importHuntedParks(file.text, holderFor(call))
    },
  }
}
