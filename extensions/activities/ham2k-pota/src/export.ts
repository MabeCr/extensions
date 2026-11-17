// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// POTA's activation export: ONE file for every park the operation activated.
//
// POTA's uploader reads MY_POTA_REF and POTA_REF as comma-separated lists, so
// an n-fer is one file whose records name every park, and a park-to-park
// contact with an n-fer is one record naming every park hunted. The SDK's
// `activityExportHook` offers a file per activated reference, which is still
// what the other reference programs want; POTA deliberately does not use it.
//
// Each record's MY_POTA_REF comes from the operation in force when the contact
// was made — the core hands `adifFields` each contact's own segment — so an
// operation that moves to another park at a break still writes one file, with
// every contact claiming only the parks it was actually made at.

import { adifForExport, exportFilename, exportTypeDefinition, startMillisOf } from "@ham2k/extension-sdk"
import type { ExportOption, ExportOptionsRequest, ExportRequest, ExportResult, ExportTypeDefinition, HookContext, JSONValue } from "@ham2k/extension-sdk"

import { tFor } from "./i18n.ts"

const ACTIVATION_TYPE = 'potaActivation'
const EXPORT_TYPE = `${ACTIVATION_TYPE}-adif`

/// Which fields name the parks in POTA's own files. POTA reads MY_POTA_REF and
/// POTA_REF, which list every park; MY_SIG_INFO and SIG_INFO take one park
/// each, so with them a multi-park record names its first park twice over and
/// the others once. Offered on both POTA file types (`ExportTypeDefinition.
/// choices`, extension API 25).
const SIG_FIELDS = 'sigFields'
const SIG_FIELDS_DEFAULT = 'potaRef'
const SIG_FIELDS_BOTH = 'both'

function sigFieldsChoice(ctx: { locale?: string }) {
  const t = tFor(ctx)
  return {
    key: SIG_FIELDS,
    label: t('sigFieldsLabel'),
    description: t('sigFieldsDescription'),
    options: [
      { value: SIG_FIELDS_DEFAULT, label: t('sigFieldsPotaRef') },
      { value: SIG_FIELDS_BOTH, label: t('sigFieldsBoth') },
    ],
    default: SIG_FIELDS_DEFAULT,
  }
}

/// [hook]'s export types, each with the park-fields choice — for the Hunter
/// Log, whose hook comes from the SDK.
export function withSigFieldsChoice<H extends { getExportTypes(): Promise<ExportTypeDefinition[]> }>(hook: H): H {
  return {
    ...hook,
    async getExportTypes(_args?: unknown, ctx?: HookContext) {
      return (await hook.getExportTypes()).map((definition) => ({ ...definition, choices: [sigFieldsChoice(ctx ?? {})] }))
    },
  }
}

/// Whether a record carries SIG/SIG_INFO and MY_SIG/MY_SIG_INFO beside the
/// POTA_REF pair. Only POTA's own files follow the operator's pick: the full
/// ADIF export is the operator's own record, and a state-park contest's file
/// that includes POTA's fields is read by a sponsor that wants SIG_INFO.
///
/// No pick at all is an app older than extension API 25: an app that shows
/// the choice always sends one, the default included. That app never offered
/// the operator a way back to SIG_INFO, so its files keep writing both.
export function writesSigFields({ mainHandler, exportSettings }: { mainHandler?: boolean; exportSettings?: { choices?: Record<string, string> } }): boolean {
  if (!mainHandler) return true
  const pick = exportSettings?.choices?.[SIG_FIELDS]
  return pick === undefined || pick === SIG_FIELDS_BOTH
}

interface Park {
  ref: string
  name?: string
}

function parksOf(operation: Record<string, JSONValue>): Park[] {
  const refs = (operation.refs as Record<string, JSONValue>[] | undefined) ?? []
  const parks: Park[] = []
  for (const r of refs) {
    if (r?.type !== ACTIVATION_TYPE || typeof r.ref !== 'string' || r.ref.length === 0) continue
    if (parks.some((p) => p.ref === r.ref)) continue
    parks.push({ ref: r.ref, name: typeof r.name === 'string' ? r.name : undefined })
  }
  return parks
}

/// Shared by the option and the generated result: the panel shows one and the
/// core writes the other, and the two must not disagree in front of the
/// operator.
function filenameFor(operation: Record<string, JSONValue>, qsos: Record<string, JSONValue>[], parks: Park[], compact?: boolean): string {
  return exportFilename({
    stationCall: operation.stationCall,
    ref: parks.map((p) => p.ref).join(','),
    startAtMillis: startMillisOf(operation, qsos),
    extension: 'adi',
    compact,
  })
}

/// [key] is the extension's own key: the file is that extension's log, so it
/// is the `mainHandler` the core asks for program fields, and the prefix of
/// the option's exportKey.
export function potaExportHook({ key, includeFieldsFrom }: { key: string; includeFieldsFrom?: string[] }) {
  const exportKey = `${key}-adif`

  return {
    async getExportTypes(_args?: unknown, ctx?: HookContext): Promise<ExportTypeDefinition[]> {
      return [
        {
          ...exportTypeDefinition(ACTIVATION_TYPE, 'adif', 'POTA'),
          templateCategory: 'reference',
          templateSample: { log: { ref: 'US-1234', refName: 'Example Park' }, operation: { refs: [{ type: ACTIVATION_TYPE, ref: 'US-1234' }] } },
          choices: [sigFieldsChoice(ctx ?? {})],
        } as ExportTypeDefinition,
      ]
    },

    async suggestExportOptions({ operation, qsos, compactFilenames }: ExportOptionsRequest, ctx: HookContext): Promise<ExportOption[]> {
      // The core lists every park any segment carries on `operation.refs`, so
      // a park moved away from at a break is still here.
      const parks = parksOf(operation)
      if (parks.length === 0) return []
      const t = tFor(ctx)
      const refs = parks.map((p) => p.ref)
      const option: ExportOption & { instructions: string } = {
        exportType: EXPORT_TYPE,
        exportKey,
        format: 'adif',
        label: t('adifForParks', { parks: refs.join(', ') }),
        templateData: { ref: refs.join(','), refName: parks.map((p) => p.name ?? '').filter(Boolean).join(', '), activity: 'POTA' },
        filename: filenameFor(operation, qsos ?? [], parks, compactFilenames),
        instructions: parks.length > 1 ? t('uploadInstructionsMany') : t('uploadInstructionsOne'),
        icon: 'pine-tree',
        selectedByDefault: true,
        // No `ref`, and `templateData.ref` is the joined list, which names no
        // single park: the core slices by `ref`, else by `templateData.ref`,
        // and only a value matching no park widens the slice to every
        // activated park. Setting either to one park writes a file labelled
        // for every park that holds that one park's contacts.
        refType: ACTIVATION_TYPE,
      }
      return [option]
    },

    async generateExport(args: ExportRequest, _ctx: HookContext): Promise<ExportResult> {
      // Answer ONLY for the option offered above: answering for another export
      // makes the ADIF delegation below recurse into itself.
      if (args.exportType !== EXPORT_TYPE || args.exportKey !== exportKey) {
        throw new Error(`${key}: unknown export type/key '${args.exportType}' / '${args.exportKey}'`)
      }
      // Parks removed between listing and writing leave nothing to name the
      // file for. This checks the operation only: a contact whose segment
      // carries no park still reaches the file, without MY_POTA_REF.
      const parks = parksOf(args.operation)
      if (parks.length === 0) throw new Error(`${key}: operation has no POTA activation`)

      const content = await adifForExport({
        operation: args.operation,
        qsos: args.qsos,
        segments: args.segments,
        includePrivateData: args.includePrivateData,
        includeLookupData: args.includeLookupData,
        exportSettings: args.exportSettings,
        exportData: args.exportData,
        exportTitle: args.exportTitle,
        mainHandler: key,
        includeFieldsFrom,
      })
      return { filename: filenameFor(args.operation, args.qsos, parks, args.compactFilenames), mimeType: 'text/plain', content }
    },
  }
}
