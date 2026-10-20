// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The files a party's log leaves as: the sponsor's Cabrillo, and a contest ADIF
// that resolves every exchange the same way the Cabrillo does.
//
// Both read our county off the operation that was true when each contact was
// made: the host sends the resolved segments (`ExportRequest.segments`), and
// the core ADIF generator hands `adifFields` the segment-effective operation —
// see `ourLocationForQso`. Nothing about where we were is stamped onto a
// contact; a stamp is a copy a later correction cannot reach.

import { adifForExport, exportTypeDefinition, exportFilename, startMillisOf } from "@ham2k/extension-sdk"
import type {
  AdifFieldsHook,
  ExportHook,
  ExportOption,
  ExportOptionsRequest,
  ExportRequest,
  ExportResult,
  HookContext,
  JSONValue,
} from "@ham2k/extension-sdk"

import { ourLocationText, ourName, ourSerialOf, partyContactRefIn, partyRefIn, str, theirSerialOf } from "./entry.ts"
import {
  cabrilloFor,
  RESOLVED_MARKER,
  resolvedExchanges,
  theirLocationForFile,
} from "./exchange.ts"
import { allInParty, entityPrefixOf, parseOurLocations, theirLocations } from "./location.ts"
import { US_STATES } from "./locations.ts"
import type { QsoPartyExtensionParams, QsoPartyLocation, QsoPartyParams } from "./params.ts"
import { type Party, resolveLabel, resolveParty, stateForCounty } from "./party.ts"

function filenameFor(
  party: Party,
  operation: Record<string, JSONValue>,
  qsos: Record<string, JSONValue>[],
  extension: string,
  compact?: boolean,
): string {
  return exportFilename({
    stationCall: operation.stationCall,
    activity: party.short,
    startAtMillis: startMillisOf(operation, qsos),
    extension,
    compact,
  })
}

type AdifField = { name: string; value: string }

/// The ADIF hook, with the multi-record method the SDK's type does not declare
/// yet — the host asks for it where a hook has it (`docs/hooks.md`).
export type QsoPartyAdifFieldsHook = AdifFieldsHook & {
  fieldCombinationsForOneQSO(
    args: { qso: Record<string, JSONValue>; operation: Record<string, JSONValue>; mainHandler?: boolean },
    ctx: HookContext,
  ): Promise<AdifField[][]>
}

/// A county as ADIF's `CNTY` and `MY_CNTY` write it — `NY,Erie`: the state,
/// then the county's name without "County" or "Parish", with "St." and "&"
/// spelled out. Only a county of a US state has one: ADIF names no Canadian
/// district, and a state, a province or a DX entity is not a county at all.
export function adifCountyOf(party: Party, code: string): { state: string; county: string } | undefined {
  const name = party.counties[code] ?? party.otherCounties[code]
  if (!name) return undefined
  const state = stateForCounty(party, code)
  if (!US_STATES[state]) return undefined
  const declared = party.adifCounties[code]
  if (declared) return { state, county: declared }

  let county = name.trim()
  // A party spanning several states tells same-named counties apart by their
  // state ("Adams IN", "Washington County VT"). Any OTHER state at the end says
  // the entry is not one of this state's counties: MDQP's "Washington DC".
  const suffix = /\s+([A-Z]{2})$/.exec(county)
  if (suffix) {
    if (suffix[1] !== state) return undefined
    county = county.slice(0, suffix.index)
  }
  // Virginia's independent cities are "Alexandria (City)" in the party's list,
  // and the same "City" the other states' cities carry in their names here.
  county = county.replace(/\s+(County|Parish)$/i, '').replace(/\s+\(City\)$/, ' City')
  // Spelled out, as most of the lists already have it: "St. Lawrence" and
  // "St Johns" beside "Saint Clair" and "Saint Mary's"; "Lewis & Clark".
  county = county.replace(/\bSt\.?\s+/g, 'Saint ').replace(/\s*&\s*/g, ' and ')
  return { state, county }
}

/// The state and county fields one end of a pairing adds, with the state
/// written beside the county so the two cannot disagree — a contact's own
/// `STATE` comes from a callsign lookup, and a station on the road is not in it.
function countyFields(party: Party, location: QsoPartyLocation, prefix: '' | 'MY_'): AdifField[] {
  const found = adifCountyOf(party, location.code)
  if (!found) return []
  return [
    { name: `${prefix}STATE`, value: found.state },
    { name: `${prefix}CNTY`, value: `${found.state},${found.county}` },
  ]
}

export function qsoPartyAdifFields(params: QsoPartyParams): QsoPartyAdifFieldsHook {
  const party = resolveParty(params)

  /// What every record of one contact shares, and what tells its ends apart.
  /// Undefined for a log that is not this party's.
  function contactFor(qso: Record<string, JSONValue>, operation: Record<string, JSONValue>) {
    // The full ADIF export asks every installed extension about every
    // contact, so an operation that is not this party's gets nothing here.
    // Without this, every other log leaves stamped with this party's
    // CONTEST_ID, and with an SRX_STRING made up from the other station's
    // state.
    const opRef = partyRefIn(party, operation as Record<string, unknown>)
    if (!opRef) return undefined

    const qsoRef = partyContactRefIn(party, qso as Record<string, unknown>, operation as Record<string, unknown>)
    // `operation` is already the segment-effective one for this contact (the
    // core generator resolves it), so our county is simply the operation's.
    const ours = ourLocationText(party, operation as Record<string, unknown>, opRef)
    const ourLocations = parseOurLocations(party, ours)
    const weAreInParty = allInParty(ourLocations)
    // Through the same resolution the Cabrillo takes, so the two files cannot
    // disagree about the same contact — a party that logs a DX station by its
    // prefix would otherwise write the prefix here and `DX` there. Our own
    // export also hands over what it resolved for the whole log, which is the
    // only way this hook can know what a station sent on an earlier band.
    const resolved = opRef[RESOLVED_MARKER] as Record<string, string> | undefined
    const theirs = resolved?.[str(qso.uuid)]
      ?? theirLocationForFile(party, qso, { weAreInParty, operation: operation as Record<string, unknown> })
    const theirLocationList = theirLocations(party, theirs, {
      entityPrefix: entityPrefixOf(qso as Record<string, unknown>),
      weAreInParty,
      received: true,
    }).locations

    return {
      ours,
      theirs,
      ourLocations,
      theirLocations: theirLocationList,
      ourSerial: ourSerialOf(qsoRef),
      theirSerial: theirSerialOf(qsoRef),
      theirName: str(qsoRef?.theirName),
      ourOwnName: ourName(party, operation as Record<string, unknown>, opRef),
    }
  }

  /// The exchange as SENT and received, in the order it was sent: serial,
  /// name, location.
  function exchangeFields(
    contact: NonNullable<ReturnType<typeof contactFor>>,
    ourLocation: string,
    theirLocation: string,
  ): AdifField[] {
    const { ourSerial, theirSerial, theirName, ourOwnName } = contact
    // `CONTEST_ID` is the sponsor's published contest name — the same
    // vocabulary the Cabrillo's `CONTEST:` line uses, which is what ADIF's own
    // contest list is built from.
    const fields = [{ name: 'CONTEST_ID', value: party.cabrilloName ?? party.short }]

    const sent = [ourSerial, ourOwnName, ourLocation].filter((part) => part).join(' ')
    const received = [theirSerial, theirName, theirLocation].filter((part) => part).join(' ')
    if (sent) fields.push({ name: 'STX_STRING', value: sent })
    if (received) fields.push({ name: 'SRX_STRING', value: received })
    if (ourSerial) fields.push({ name: 'STX', value: ourSerial })
    if (theirSerial) fields.push({ name: 'SRX', value: theirSerial })
    if (ourOwnName) fields.push({ name: 'MY_NAME', value: ourOwnName })
    if (theirName) fields.push({ name: 'NAME', value: theirName })
    return fields
  }

  return {
    /// The whole contact as one record, for a host that cannot write several.
    async fieldsForOneQSO({ qso, operation }, _ctx) {
      const contact = contactFor(qso, operation)
      if (!contact) return []
      return exchangeFields(contact, contact.ours, contact.theirs)
    },

    /// One record per pairing of our counties with theirs, as the Cabrillo has
    /// one line per pairing: each is a contact of its own for the checker, and
    /// for a county award each record names the one county it confirms.
    async fieldCombinationsForOneQSO({ qso, operation }, _ctx) {
      const contact = contactFor(qso, operation)
      if (!contact) return []
      if (contact.ourLocations.length === 0 || contact.theirLocations.length === 0) {
        return [exchangeFields(contact, contact.ours, contact.theirs)]
      }
      return contact.ourLocations.flatMap((ours) => contact.theirLocations.map((theirs) => [
        ...exchangeFields(contact, ours.sent, theirs.sent),
        ...countyFields(party, ours, 'MY_'),
        ...countyFields(party, theirs, ''),
      ]))
    },
  }
}

export function qsoPartyExport(params: QsoPartyExtensionParams): ExportHook {
  const party = resolveParty(params)

  return {
    async getExportTypes() {
      return [
        exportTypeDefinition(party.refType, 'adif', party.short),
        ...(party.cabrilloName ? [exportTypeDefinition(party.refType, 'cabrillo', party.short)] : []),
      ]
    },
    async suggestExportOptions(args: ExportOptionsRequest, ctx: HookContext): Promise<ExportOption[]> {
      if (!partyRefIn(party, args.operation as Record<string, unknown>)) return []
      const named = (extension: string) =>
        filenameFor(party, args.operation, args.qsos ?? [], extension, args.compactFilenames)

      const options: ExportOption[] = [{
        exportType: `${party.refType}-adif`,
        templateData: { activity: party.short },
        format: 'adif',
        label: resolveLabel(party.labels.adifExport, ctx, `ADIF for ${party.short}`),
        filename: named('adi'),
        selectedByDefault: true,
        refType: party.refType,
      }]

      // A party that names no contest cannot produce a submittable Cabrillo: the
      // `CONTEST:` line is what tells a checker which contest the file is for,
      // and inventing one produces a file that looks submittable and is not.
      if (party.cabrilloName) {
        options.push({
          exportType: `${party.refType}-cabrillo`,
          templateData: { activity: party.short },
          format: 'cabrillo',
          label: resolveLabel(party.labels.cabrilloExport, ctx, `Cabrillo for ${party.short}`),
          filename: named('log'),
          selectedByDefault: true,
          refType: party.refType,
        })
      }

      return options
    },

    async generateExport(args: ExportRequest, _ctx: HookContext): Promise<ExportResult> {
      // Only the two exportTypes offered above: a hook answering for an
      // exportType it never offered makes the ADIF delegation recurse.
      if (args.exportType !== `${party.refType}-cabrillo` && args.exportType !== `${party.refType}-adif`) {
        return { filename: '', mimeType: '', content: '' }
      }

      const operation = args.operation
      const segments = args.segments

      if (args.exportType === `${party.refType}-cabrillo`) {
        return {
          filename: filenameFor(party, operation, args.qsos, 'log', args.compactFilenames),
          mimeType: 'text/plain',
          content: cabrilloFor(party, operation, args.qsos, segments),
        }
      }

      // Every contact's exchange, resolved once for the whole log and carried to
      // `adifFields` on a COPY of the operation — of every segment's operation
      // too, since the core generator hands the hook the segment-effective one
      // and would otherwise hand it an unmarked copy. Never the stored operation.
      // The ref marked is the one `adifFields` reads (`partyRefIn`), so a log kept
      // under the old combined extension's `qp` type is marked too.
      const resolved = resolvedExchanges(party, operation, args.qsos, segments)
      const marked = (op: Record<string, JSONValue>): Record<string, JSONValue> => {
        const ours = partyRefIn(party, op as Record<string, unknown>)
        return {
          ...op,
          refs: ((op.refs as Record<string, JSONValue>[] | undefined) ?? []).map((r) =>
            r === ours ? { ...r, [RESOLVED_MARKER]: resolved } : r),
        }
      }
      const content = await adifForExport({
        operation: marked(operation),
        segments: segments?.map((segment) => ({ ...segment, operation: marked(segment.operation) })),
        qsos: args.qsos,
        includePrivateData: args.includePrivateData,
        includeLookupData: args.includeLookupData,
        exportSettings: args.exportSettings,
        exportData: args.exportData,
        exportTitle: args.exportTitle,
        // This file is the CONTEST's log, so the core exporter asks this
        // extension's `adifFields` hook and no other's — by the key it is
        // registered under (`QsoPartyExtensionParams`).
        mainHandler: params.extensionKey,
      })
      return {
        filename: filenameFor(party, operation, args.qsos, 'adi', args.compactFilenames),
        mimeType: 'text/plain',
        content,
      }
    },
  }
}
