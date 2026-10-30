// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// CQ WPX Contest. Ported from app-polo's CQWPXExtension.
//
// What sets it apart from the other CQ
// contests: a SERIAL NUMBER exchange. In app-polo the
// sent number is state on the operation ref, bumped by a dispatch after each
// save — which leaks a number whenever a half-composed QSO is wiped, and hands
// the same number to two QSOs if a spot is tapped mid-entry. Here the extension
// only DECLARES the sequence; the core allocates from it inside the QSO insert
// (docs/design/contests.md §5.8), so neither failure is reachable.

import { exportTypeDefinition } from "@ham2k/extension-sdk"
import { qsonToCabrillo } from "@ham2k/lib-qson-cabrillo"
import { rulesNotes, withRules } from "@ham2k/lib-contest-rules"
import { adifForExport, contestScorer, defineExtension, exportFilename, host, startMillisOf } from "@ham2k/extension-sdk"
import type {
  ActivitySuggestion,
  ExportOption,
  ExportOptionsRequest,
  ExportRequest,
  ExportResult,
  HookContext,
  JSONValue,
  LoggingControlDescriptor,
  Ref,
  RefLink,
  SuggestArgs,
} from "@ham2k/extension-sdk"

import {
  BAND_CLASSES,
  OPERATOR_CLASSES,
  OVERLAY_CLASSES,
  POWER_CLASSES,
  cabrilloCategories,
  cabrilloLocation,
  contestRules,
  declaredClub,
  declaredOperators,
} from "./entry.ts"
import { tFor } from "./i18n.ts"
import { MODES, nearestMode, nextContestDate, relevanceFor } from "./schedule.ts"
import { contestTitle, CQWPXScorer } from "./scorer.ts"

import manifest from "../manifest.json" with { type: "json" }

/// The ref type an operation stores. It is data in the operator's log, so it
/// stays what the app's own built-in wrote there whatever this package is
/// called: the manifest key names the package, `TYPE` names the activation.
const TYPE = 'cqwpx'

/// What a search has to contain to offer these contests. Matched as "does the
/// alias contain what was typed", so "cq" finds them and the date ranking
/// decides which running comes first.
const ALIASES = ['CQWPX', 'CQ WPX', 'WPX']

function refOfType(container: Record<string, JSONValue>, type: string): Record<string, JSONValue> | undefined {
  return (((container.refs as Record<string, JSONValue>[] | undefined) ?? [])).find((r) => r?.type === type)
}

function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

/// A serial as it should appear in an export: whatever is on the ref, as digits.
function serial(qso: Record<string, JSONValue>, field: string): string {
  const value = refOfType(qso, TYPE)?.[field]
  if (typeof value === 'number') return String(value)
  const digits = str(value).trim()
  return /^\d+$/.test(digits) ? String(parseInt(digits, 10)) : ''
}

/// The operator's name, email and club from their profile, for the Cabrillo
/// header. All optional and free-form in the profile, so each may be ''. A
/// host that cannot answer costs these lines, never the log itself.
async function profileDetails(): Promise<{ name: string; email: string; club: string }> {
  try {
    const settings = (await host.getSettings()) as Record<string, JSONValue> | undefined
    const line = (value: JSONValue | undefined) => str(value).replace(/\s+/g, ' ').trim()
    return { name: line(settings?.operatorName), email: line(settings?.operatorEmail), club: line(settings?.operatorClub) }
  } catch (e) {
    console.warn(`[cqwpx] profile settings unavailable, exporting without name, email and profile club:`, e)
    return { name: '', email: '', club: '' }
  }
}

/// One select per axis of the entry, "Not declared" first.
function entrySelects(t: (key: string) => string) {
  const select = (key: string, options: readonly string[]) => ({
    type: 'field' as const,
    fieldType: 'select' as const,
    key,
    label: t(`${key}Label`),
    value: '',
    options: [{ value: '', label: t('notDeclared') }, ...options.map((value) => ({ value, label: t(`${key}_${value}`) }))],
  })
  return [
    select('operator', OPERATOR_CLASSES),
    select('band', BAND_CLASSES),
    select('power', POWER_CLASSES),
    select('overlay', OVERLAY_CLASSES),
  ]
}

const ActivityHook = {
  /// Offered in the activity search by NAME and by NEARNESS — all three
  /// runnings, each ranked by its own weekend, so in March SSB leads and in
  /// May CW.
  ///
  /// Nothing is offered to an operation that already runs CQ WPX: as in CQ
  /// WW, the mode lives on the ref as `mode`, not `ref`, so the picker's
  /// duplicate guard would let a tapped suggestion REPLACE the configured ref.
  async suggest({ operation, searchTerm }: SuggestArgs, ctx: HookContext): Promise<ActivitySuggestion[]> {
    if (refOfType(operation ?? {}, TYPE)) return []
    const t = tFor(ctx)
    const term = (searchTerm ?? '').trim().toUpperCase()
    if (term && !ALIASES.some((alias) => alias.includes(term))) return []

    const now = Date.now()
    return MODES.map((mode) => withRules({
      type: TYPE,
      mode,
      // A suggestion is persisted VERBATIM and never runs through
      // `decorateRef`, so everything the operation row reads has to be here,
      // and the labels must match what `decorateRef` composes.
      program: 'Contest',
      // The date is what tells the runnings apart at a glance — the same
      // `description • date` line the QSO parties show.
      name: `${t('activityDescription')} • ${nextContestDate(now, mode)}`,
      label: `CQ WPX ${mode}`,
      shortLabel: `CQ WPX ${mode}`,
      relevance: relevanceFor(now, mode),
    }, contestRules(undefined)))
  },

  async operationControls(
    _args: { operation: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<LoggingControlDescriptor[]> {
    const t = tFor(ctx)
    return [
      {
        key: 'cqwpx/setup',
        label: t('activityLabel'),
        icon: manifest.icon,
        color: manifest.accentColor,
        order: 10,
        input: {
          kind: 'form',
          refType: TYPE,
          form: {
            title: t('setupLabel'),
            elements: [
              {
                type: 'field',
                fieldType: 'radio',
                key: 'mode',
                label: t('modeLabel'),
                // Seeds a new setup only; a configured ref keeps its own mode.
                value: nearestMode(Date.now()),
                // CQ WPX runs these as separate contests on separate weekends.
                options: [{ value: 'CW', label: 'CW' }, { value: 'SSB', label: 'SSB' }, { value: 'RTTY', label: 'RTTY' }],
              },
              // For the Cabrillo LOCATION line the rules require of a US
              // station (XI.C).
              {
                type: 'field',
                fieldType: 'text',
                key: 'location',
                label: t('locationLabel'),
                placeholder: t('locationPlaceholder'),
                uppercase: true,
              },
              // What the rules allow, following the operator class below.
              ...rulesNotes(ctx, 'operator', OPERATOR_CLASSES, contestRules),
              // The entry we are making, for the Cabrillo header. Each starts
              // undeclared: see entry.ts.
              ...entrySelects(t),
              {
                type: 'field',
                fieldType: 'text',
                key: 'operators',
                label: t('operatorsLabel'),
                placeholder: t('operatorsPlaceholder'),
                uppercase: true,
              },
              {
                type: 'field',
                fieldType: 'text',
                key: 'club',
                label: t('clubLabel'),
                placeholder: t('clubPlaceholder'),
              },
            ],
          },
        },
      },
    ]
  },

  /// Two fields per QSO: the number we send and the number they send.
  ///
  /// Ours is a `serial` input — the extension names the sequence and the core
  /// fills the field, so nothing here tracks a counter. It is deliberately NOT
  /// scoped per band: WPX numbers a single series for the whole entry.
  async loggingControls(
    args: { operation: Record<string, JSONValue>; qso?: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<LoggingControlDescriptor[]> {
    // Off-contest, contribute nothing. This is an OPTIMIZATION, not the rule:
    // the core already refuses a primary field to any activity the operation
    // isn't running (halo_widgets' `_textControls`), so forgetting this guard
    // is invisible to the operator. What it saves is the work below, run per
    // keystroke-triggered refresh in the JS isolate,
    // multiplied by every contest extension the user happens to have enabled.
    if (!refOfType(args.operation, TYPE)) return []

    const t = tFor(ctx)
    return [
      {
        key: 'cqwpx/ourSerial',
        label: t('ourSerialLabel'),
        icon: manifest.icon,
        color: manifest.accentColor,
        order: 10,
        input: {
          kind: 'serial',
          refType: TYPE,
          field: 'ourSerial',
          sequence: { key: 'serial' },
        },
      },
      {
        key: 'cqwpx/theirSerial',
        label: t('theirSerialLabel'),
        icon: manifest.icon,
        color: manifest.accentColor,
        order: 20,
        input: {
          kind: 'text',
          refType: TYPE,
          field: 'theirSerial',
          numeric: true,
          maxLength: 5,
          // No placeholder: there is nothing to guess about the number another
          // station is about to send.
        },
      },
    ]
  },

  /// Mirrors the serials this contest keeps on its own ref into the generic
  /// `our.exchange`/`their.exchange`. Nothing outside this extension knows to
  /// look inside a contest ref, so without this the QSO row's exchange column
  /// and a plain (non-contest) ADIF export both come up empty on a contest log.
  ///
  /// Only ever a projection: the ref stays the source of truth.
  ///
  /// Theirs follows the deliberate-blank convention: a field the operator
  /// EMPTIED is present-but-blank rather than absent (see `_refsWithTextValues`),
  /// and leaving it out of the patch would keep the previous save's value
  /// showing in the QSO row, so a cleared serial projects a blank.
  ///
  /// Ours is projected on EVERY save, blank when the ref holds no number.
  /// Serials are exempt from that convention — a cleared one is dropped from
  /// the ref, never kept as '' — and an edited QSO's `our.exchange` rides
  /// along onto calls added to it while the serial itself is stripped to be
  /// re-issued; omitting the field in either case would leave the row showing
  /// a number this QSO never sent. The second and later calls of a call list
  /// get their number from the core after this hook (see the SDK's note on
  /// `processQsoBeforeSave`), so those rows show only the received serial.
  async processQsoBeforeSave(
    args: { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> },
    _ctx: HookContext,
  ): Promise<Record<string, JSONValue> | null> {
    if (!refOfType(args.operation, TYPE)) return null
    const qsoRef = refOfType(args.qso, TYPE)
    const patch: Record<string, JSONValue> = { our: { exchange: serial(args.qso, 'ourSerial') } }
    if (qsoRef && 'theirSerial' in qsoRef) patch.their = { exchange: serial(args.qso, 'theirSerial') }
    return patch
  },
}

const RefHandler = {
  async validateRef({ ref }: { ref: Ref }, _ctx: HookContext) {
    return { valid: true, normalized: (ref.ref ?? '').trim() }
  },

  async decorateRef({ ref }: { ref: Ref }, ctx: HookContext): Promise<Ref> {
    const mode = str((ref as Record<string, JSONValue>).mode)
    const label = mode ? `CQ WPX ${mode}` : tFor(ctx)('unconfigured')
    return withRules({ ...ref, program: 'Contest', label, shortLabel: label }, contestRules((ref as Record<string, JSONValue>).operator))
  },

  /// "KI2D for CQWPX CW", subtitled with what the exchange is — unlike CQ WW's
  /// zone there is no fixed value to show, since the number changes every QSO.
  async suggestOperationTitle({ ref }: { ref: Ref }, ctx: HookContext) {
    return {
      for: contestTitle(ref as Record<string, JSONValue>),
      subtitle: tFor(ctx)('serialSubtitle'),
    }
  },

  /// The contest's published rules — a reference here names an event, not a
  /// place, so what there is to read about it is the rules it is run under.
  async linkForRef(_args: { ref: Ref }, _ctx: HookContext): Promise<RefLink | null> {
    return { url: 'https://www.cqwpx.com/rules.htm', label: 'CQ WPX' }
  },
}

const AdifFieldsHook = {
  async fieldsForOneQSO(
    { qso, operation }: { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> },
    _ctx: HookContext,
  ): Promise<{ name: string; value: string }[]> {
    const opRef = refOfType(operation, TYPE)
    if (!opRef) return []
    const mode = str(opRef.mode)

    const fields: { name: string; value: string }[] = [
      { name: 'CONTEST_ID', value: mode ? `CQ-WPX-${mode}` : 'CQ-WPX' },
    ]
    const sent = serial(qso, 'ourSerial')
    const received = serial(qso, 'theirSerial')
    if (sent) fields.push({ name: 'STX', value: sent })
    if (received) fields.push({ name: 'SRX', value: received })
    return fields
  },
}

function reportFor(qso: Record<string, JSONValue>, side: 'our' | 'their'): string {
  const sideData = (qso[side] as Record<string, JSONValue>) ?? {}
  const sent = str(sideData.sent)
  if (sent) return sent
  return str(qso.mode) === 'CW' || str(qso.mode) === 'RTTY' ? '599' : '59'
}

/// The contest's own name for this operation's file — the mode is part of
/// the identity here, since CQ WPX CW and CQ WPX SSB are separate contests
/// with separate submissions.
function contestTag(operation: Record<string, JSONValue>): string {
  const mode = str(refOfType(operation, TYPE)?.mode)
  return `CQ-WPX-${mode || 'DX'}`
}

function filenameFor(
  operation: Record<string, JSONValue>,
  qsos: Record<string, JSONValue>[],
  extension: string,
  compact?: boolean,
): string {
  return exportFilename({
    stationCall: operation.stationCall,
    activity: contestTag(operation),
    startAtMillis: startMillisOf(operation, qsos),
    extension,
    compact,
  })
}

const ExportHook = {
  async getExportTypes() {
    return [exportTypeDefinition(TYPE, 'adif', manifest.shortName), exportTypeDefinition(TYPE, 'cabrillo', manifest.shortName)]
  },
  async suggestExportOptions(args: ExportOptionsRequest, ctx: HookContext): Promise<ExportOption[]> {
    if (!refOfType(args.operation, TYPE)) return []
    const t = tFor(ctx)
    const named = (extension: string) =>
      filenameFor(args.operation, args.qsos ?? [], extension, args.compactFilenames)
    return [
      {
        exportType: `${TYPE}-adif`,
        templateData: { activity: contestTag(args.operation) },
        format: 'adif',
        label: t('adifExport', { contest: manifest.shortName }),
        filename: named('adi'),
        selectedByDefault: true,
        refType: TYPE,
      },
      {
        exportType: `${TYPE}-cabrillo`,
        templateData: { activity: contestTag(args.operation) },
        format: 'cabrillo',
        label: t('cabrilloExport', { contest: manifest.shortName }),
        filename: named('log'),
        selectedByDefault: true,
        refType: TYPE,
      },
    ]
  },

  async generateExport(args: ExportRequest, ctx: HookContext): Promise<ExportResult> {
    // Only the two exportTypes `suggestExportOptions` above offers. Belt and
    // braces alongside `adifForExport`'s keyed delegation: a hook that answers for an
    // exportType it never offered makes the ADIF delegation recurse into
    // itself.
    if (args.exportType !== `${TYPE}-cabrillo` && args.exportType !== `${TYPE}-adif`) {
      return { filename: '', mimeType: '', content: '' }
    }

    const operation = args.operation
    const mode = str(refOfType(operation, TYPE)?.mode)
    const ourCall = str(operation.stationCall)

    if (args.exportType === `${TYPE}-cabrillo`) {
      const opRef = refOfType(operation, TYPE)
      const profile = await profileDetails()
      const content = qsonToCabrillo(args.qsos, {
        headers: [
          ['CONTEST', mode ? `CQ-WPX-${mode}` : 'CQ-WPX'],
          ['CALLSIGN', ourCall],
          ['LOCATION', cabrilloLocation(ourCall, opRef?.location)],
          ...cabrilloCategories(opRef),
          // The calls listed at setup — required for a multi-operator entry —
          // else the app's own operator call.
          ['OPERATORS', declaredOperators(opRef) || str((operation.local as Record<string, JSONValue>)?.operatorCall)],
          ['GRID-LOCATOR', str(operation.grid)],
          // The club typed at setup, else the profile's.
          ['CLUB', declaredClub(opRef) || profile.club],
          ['NAME', profile.name],
          ['EMAIL', profile.email],
        ],
        qsoParts: (qso) => [
          ourCall || '-',
          reportFor(qso, 'our'),
          serial(qso, 'ourSerial') || '0',
          str(((qso.their as Record<string, JSONValue>) ?? {}).call) || '-',
          reportFor(qso, 'their'),
          serial(qso, 'theirSerial') || '0',
        ],
      })
      return {
        filename: filenameFor(operation, args.qsos, 'log', args.compactFilenames),
        mimeType: 'text/plain',
        content,
      }
    }

    const content = await adifForExport({
      operation: args.operation,
      qsos: args.qsos,
      segments: args.segments,
      includePrivateData: args.includePrivateData,
      includeLookupData: args.includeLookupData,
      exportSettings: args.exportSettings,
      exportData: args.exportData,
      exportTitle: args.exportTitle,
      // This file is the CONTEST's log, so the core exporter asks this
      // extension's `adifFields` hook and no other's — app-polo's main
      // handler (see `ExportRequest.mainHandler`).
      mainHandler: manifest.key,
    })
    return {
      filename: filenameFor(operation, args.qsos, 'adi', args.compactFilenames),
      mimeType: 'text/plain',
      content,
    }
  },
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook('activity', { hook: ActivityHook, key: manifest.key })
    registerHook(`ref:${TYPE}`, { hook: RefHandler, key: manifest.key })
    registerHook('adifFields', { hook: AdifFieldsHook, key: manifest.key })
    registerHook('export', { hook: ExportHook, key: manifest.key })
    registerHook('scoring', {
      hook: contestScorer(CQWPXScorer, { scope: { refTypes: [TYPE] } }),
      key: manifest.key,
    })
  },
})
