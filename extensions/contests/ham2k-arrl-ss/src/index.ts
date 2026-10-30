// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// ARRL November Sweepstakes — new here; app-polo never had it.
//
// The longest exchange of any contest the app runs, all of it logged: serial,
// precedence, call, check and section, "123 A W9JJ 79 CT". Ours comes from the
// setup — the serial counts itself — and theirs is four fields per QSO. The
// sections are the multipliers, the same 85 as Field Day's minus DX, and the
// clock is the other rule that shapes the weekend: only 24 of the 30 hours
// score (see scorer.ts).

import { exportTypeDefinition } from "@ham2k/extension-sdk"
import { qsonToCabrillo } from "@ham2k/lib-qson-cabrillo"
import { rulesNotes, withRules } from "@ham2k/lib-contest-rules"
import { adifForExport, contestScorer, defineExtension, exportFilename, host, startMillisOf } from "@ham2k/extension-sdk"
import type {
  ActivitySuggestion,
  DataFileDefinition,
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

import { tFor } from "./i18n.ts"
import { MODES, nearestMode, nextContestDate, relevanceFor } from "./schedule.ts"
import type { SSMode } from "./schedule.ts"
import { SSScorer, TYPE, contestTitle } from "./scorer.ts"
import { ALL_SECTIONS } from "./sections.ts"
import { normalizeSection, preferredSections } from "./exchange.ts"
import { HISTORY_STEMS, historyFor, loadHistory, parseHistory, removeHistory } from "./history.ts"
import {
  CHECK_PATTERN,
  ENTRY_CLASSES,
  PRECEDENCE_PATTERN,
  cabrilloCategories,
  contestRules,
  declaredClub,
  declaredOperators,
  normalizeCheck,
  normalizePrecedence,
  ourPrecedence,
} from "./entry.ts"

import manifest from "../manifest.json" with { type: "json" }

/// What a search has to contain to offer these contests. Matched as "does the
/// alias contain what was typed", so "arrl" finds them and the date ranking
/// decides which running comes first.
const ALIASES = ['ARRL SS', 'ARRL SWEEPSTAKES', 'SWEEPSTAKES', 'NOVEMBER SWEEPSTAKES', 'SS CW', 'SS PHONE', 'SS SSB']

/// Every section as a selectable option, with its name — what the operator
/// searches. Built once: the list is static.
const SECTION_OPTIONS = Object.keys(ALL_SECTIONS)
  .sort()
  .map((code) => ({ code, name: ALL_SECTIONS[code] }))

function refOfType(container: Record<string, JSONValue>, type: string): Record<string, JSONValue> | undefined {
  return (((container.refs as Record<string, JSONValue>[] | undefined) ?? [])).find((r) => r?.type === type)
}

function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

/// "ARRL SS CW", "ARRL SS Phone" — the label for a running of [mode].
function labelFor(mode: string): string {
  return contestTitle({ mode })
}

/// A serial as it should appear in an export: whatever is on the ref, as digits.
function serial(qso: Record<string, JSONValue>, field: string): string {
  const value = refOfType(qso, TYPE)?.[field]
  if (typeof value === 'number') return String(value)
  const digits = str(value).trim()
  return /^\d+$/.test(digits) ? String(parseInt(digits, 10)) : ''
}

/// A part of an exchange as it should be shown and exported: the valid value,
/// or else what was typed — a value that isn't one is still what the operator
/// sent or copied, and dropping it would make the exchange look complete.
function asTyped(value: JSONValue | undefined, normalized: string): string {
  return normalized || String(value ?? '').replace(/\s+/g, '').toUpperCase()
}

/// Our exchange after the serial — precedence, check and section, "A 79 CT" —
/// from the setup. Whatever is not set yet is simply missing.
function ourExchange(ref: Record<string, JSONValue> | undefined): string {
  return [ourPrecedence(ref), ourCheck(ref), ourSection(ref)].filter((part) => part).join(' ')
}

function ourCheck(ref: Record<string, JSONValue> | undefined): string {
  return asTyped(ref?.check, normalizeCheck(ref?.check))
}

function ourSection(ref: Record<string, JSONValue> | undefined): string {
  return asTyped(ref?.section, normalizeSection(ref?.section))
}

/// Their exchange as received on [qso], serial first: "123 A 79 CT".
function theirExchange(qso: Record<string, JSONValue>): string {
  const ref = refOfType(qso, TYPE)
  return [
    serial(qso, 'theirSerial'),
    asTyped(ref?.theirPrecedence, normalizePrecedence(ref?.theirPrecedence)),
    asTyped(ref?.theirCheck, normalizeCheck(ref?.theirCheck)),
    asTyped(ref?.theirSection, normalizeSection(ref?.theirSection)),
  ].filter((part) => part).join(' ')
}

/// The operator's own section, from their profile, for the setup form's
/// `value`. STICKY ON FAILURE, as in `fd`: the form re-applies a field's
/// `value` when a re-fetched definition disagrees with the previous one, so a
/// host that answers once and then cannot must not blank the section in front
/// of the operator. Empty until the first successful read.
let lastKnownSection = ''

async function ourSectionDefault(): Promise<string> {
  try {
    const settings = (await host.getSettings()) as Record<string, JSONValue> | undefined
    lastKnownSection = normalizeSection(settings?.operatorSection)
  } catch (e) {
    console.warn(`[arrl-ss] profile settings unavailable, keeping the last section read:`, e)
  }
  return lastKnownSection
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
    console.warn(`[arrl-ss] profile settings unavailable, exporting without name, email and profile club:`, e)
    return { name: '', email: '', club: '' }
  }
}

const ActivityHook = {
  /// Offered in the activity search by NAME and by NEARNESS — both runnings,
  /// each ranked by its own weekend.
  ///
  /// Nothing is offered to an operation that already runs Sweepstakes: the
  /// picker's duplicate guard only fires for a suggestion with a `ref`, so a
  /// tapped suggestion would REPLACE the configured ref and lose its setup.
  async suggest({ operation, searchTerm }: SuggestArgs, ctx: HookContext): Promise<ActivitySuggestion[]> {
    if (refOfType(operation ?? {}, TYPE)) return []
    const t = tFor(ctx)
    const term = (searchTerm ?? '').trim().toUpperCase()
    if (term && !ALIASES.some((alias) => alias.includes(term))) return []

    const now = Date.now()
    return MODES.map((mode) => ({
      type: TYPE,
      mode,
      // A suggestion is persisted VERBATIM and never runs through
      // `decorateRef`, so everything the operation row reads has to be here,
      // and the labels must match what `decorateRef` composes.
      program: 'Contest',
      name: `${t('activityDescription')} • ${nextContestDate(now, mode)}`,
      label: labelFor(mode),
      shortLabel: labelFor(mode),
      relevance: relevanceFor(now, mode),
    }))
  },

  async operationControls(
    _args: { operation: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<LoggingControlDescriptor[]> {
    const t = tFor(ctx)
    const profileSection = await ourSectionDefault()
    return [
      {
        key: 'arrl-ss/setup',
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
                options: MODES.map((mode: SSMode) => ({ value: mode, label: t(`mode_${mode}`) })),
              },
              // The entry IS the precedence we send, so it is asked first and
              // named for that. "Not declared" first: see entry.ts.
              {
                type: 'field',
                fieldType: 'select',
                key: 'entry',
                label: t('entryLabel'),
                value: '',
                options: [
                  { value: '', label: t('notDeclared') },
                  ...ENTRY_CLASSES.map((value) => ({ value, label: t(`entry_${value}`) })),
                ],
              },
              {
                type: 'field',
                fieldType: 'text',
                key: 'check',
                label: t('ourCheckLabel'),
                placeholder: t('ourCheckPlaceholder'),
              },
              {
                type: 'field',
                fieldType: 'text',
                key: 'section',
                label: t('ourSectionLabel'),
                placeholder: t('ourSectionPlaceholder'),
                uppercase: true,
                value: profileSection,
              },
              // What the rules allow, following the entry above.
              ...rulesNotes(ctx, 'entry', ENTRY_CLASSES, contestRules),
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

  /// Our serial, then the four things they send, in the order they send them:
  /// "123 A W9JJ 79 CT".
  ///
  /// Ours is a `serial` input — the extension names the sequence and the core
  /// fills the field. One series for the whole contest, as the rules number it.
  async loggingControls(
    args: { operation: Record<string, JSONValue>; qso?: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<LoggingControlDescriptor[]> {
    // Off-contest, contribute nothing. The core already refuses a primary field
    // to an activity the operation isn't running; this saves the work.
    const opRef = refOfType(args.operation, TYPE)
    if (!opRef) return []

    const t = tFor(ctx)
    const their = (args.qso?.their as Record<string, JSONValue>) ?? {}
    // The check and section this station sent before, from N1MM's call
    // history, written in as a guess: the core fills a field with it only while
    // the field is empty or still holds an earlier guess, so what the operator
    // copies always stands.
    const history = historyFor(str(their.call), opRef.mode)
    const historySection = history?.section ?? ''
    const historyCheck = history?.check ?? ''
    const preferred = preferredSections(their)
    const control = (key: string, label: string, order: number) => ({
      key: `arrl-ss/${key}`,
      label: t(label),
      icon: manifest.icon,
      color: manifest.accentColor,
      order,
    })

    return [
      { ...control('ourSerial', 'ourSerialLabel', 10), input: { kind: 'serial', refType: TYPE, field: 'ourSerial', sequence: { key: 'serial' } } },
      // No guesses for their serial or precedence: there is nothing to go on
      // for a number or an entry class another station is about to send.
      { ...control('theirSerial', 'theirSerialLabel', 20), input: { kind: 'text', refType: TYPE, field: 'theirSerial', numeric: true, maxLength: 5 } },
      {
        ...control('theirPrecedence', 'precedenceLabel', 30),
        input: { kind: 'text', refType: TYPE, field: 'theirPrecedence', maxLength: 1, uppercase: true, pattern: PRECEDENCE_PATTERN },
      },
      {
        ...control('theirCheck', 'checkLabel', 40),
        input: {
          kind: 'text',
          refType: TYPE,
          field: 'theirCheck',
          numeric: true,
          maxLength: 2,
          pattern: CHECK_PATTERN,
          ...(historyCheck ? { suggestedValue: historyCheck } : {}),
        },
      },
      {
        ...control('theirSection', 'sectionLabel', 50),
        input: {
          kind: 'options',
          refType: TYPE,
          field: 'theirSection',
          options: SECTION_OPTIONS,
          preferredCodes: historySection ? [historySection, ...preferred.filter((code) => code !== historySection)] : preferred,
          uppercase: true,
          minCharsForSuggestions: 1,
          ...(historySection ? { suggestedValue: historySection } : {}),
        },
      },
    ] as LoggingControlDescriptor[]
  },

  /// Mirrors the exchange this contest keeps on its own ref into the generic
  /// `our.exchange`/`their.exchange`. Nothing outside this extension knows to
  /// look inside a contest ref, so without this the QSO row's exchange column
  /// and a plain (non-contest) ADIF export both come up empty.
  ///
  /// Only ever a projection: the ref stays the source of truth. Ours is
  /// projected on every save, as in `cqwpx` — a serial is never kept as ''.
  /// Theirs projects whenever any of its four fields is present, blank
  /// included, so clearing them on an edit clears the row too.
  async processQsoBeforeSave(
    args: { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> },
    _ctx: HookContext,
  ): Promise<Record<string, JSONValue> | null> {
    const opRef = refOfType(args.operation, TYPE)
    if (!opRef) return null
    const qsoRef = refOfType(args.qso, TYPE)
    const ours = [serial(args.qso, 'ourSerial'), ourExchange(opRef)].filter((part) => part).join(' ')
    const patch: Record<string, JSONValue> = { our: { exchange: ours } }
    const decided = qsoRef && ['theirSerial', 'theirPrecedence', 'theirCheck', 'theirSection'].some((key) => key in qsoRef)
    if (decided) patch.their = { exchange: theirExchange(args.qso) }
    return patch
  },
}

const RefHandler = {
  async validateRef({ ref }: { ref: Ref }, _ctx: HookContext) {
    return { valid: true, normalized: (ref.ref ?? '').trim() }
  },

  async decorateRef({ ref }: { ref: Ref }, ctx: HookContext): Promise<Ref> {
    const t = tFor(ctx)
    const mode = str((ref as Record<string, JSONValue>).mode)
    const label = mode ? labelFor(mode) : t('unconfigured')
    const own = ourExchange(ref as Record<string, JSONValue>)
    const decorated = { ...ref, program: 'Contest', label, shortLabel: label, name: own || t('notConfigured') }
    return withRules(decorated, contestRules((ref as Record<string, JSONValue>).entry))
  },

  /// "KI2D for ARRL SS CW" with "A 79 CT" beneath it: the sent exchange is the
  /// one thing an operator re-reads constantly during a contest.
  async suggestOperationTitle({ ref }: { ref: Ref }, _ctx: HookContext) {
    const own = ourExchange(ref as Record<string, JSONValue>)
    return { for: contestTitle(ref as Record<string, JSONValue>), subtitle: own || undefined }
  },

  /// The contest's published rules.
  async linkForRef(_args: { ref: Ref }, _ctx: HookContext): Promise<RefLink | null> {
    return { url: 'https://www.arrl.org/sweepstakes', label: 'ARRL Sweepstakes' }
  },
}

/// The CONTEST line and ADIF CONTEST_ID: `ARRL-SS-CW`, `ARRL-SS-SSB`.
function contestId(operation: Record<string, JSONValue>): string {
  const mode = str(refOfType(operation, TYPE)?.mode)
  return mode ? `ARRL-SS-${mode}` : 'ARRL-SS'
}

const AdifFieldsHook = {
  async fieldsForOneQSO(
    { qso, operation }: { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> },
    _ctx: HookContext,
  ): Promise<{ name: string; value: string }[]> {
    const opRef = refOfType(operation, TYPE)
    if (!opRef) return []
    const qsoRef = refOfType(qso, TYPE)

    const fields: { name: string; value: string }[] = [{ name: 'CONTEST_ID', value: contestId(operation) }]
    const add = (name: string, value: string) => {
      if (value) fields.push({ name, value })
    }
    add('STX', serial(qso, 'ourSerial'))
    add('SRX', serial(qso, 'theirSerial'))
    // ADIF's own fields for the parts of theirs that have one.
    add('PRECEDENCE', normalizePrecedence(qsoRef?.theirPrecedence))
    add('CHECK', normalizeCheck(qsoRef?.theirCheck))
    add('ARRL_SECT', normalizeSection(qsoRef?.theirSection))
    // And both whole, as sent and received.
    add('STX_STRING', [serial(qso, 'ourSerial'), ourExchange(opRef)].filter((part) => part).join(' '))
    add('SRX_STRING', theirExchange(qso))
    return fields
  },
}

function filenameFor(
  operation: Record<string, JSONValue>,
  qsos: Record<string, JSONValue>[],
  extension: string,
  compact?: boolean,
): string {
  return exportFilename({
    stationCall: operation.stationCall,
    activity: contestId(operation),
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
    const named = (extension: string) => filenameFor(args.operation, args.qsos ?? [], extension, args.compactFilenames)
    return [
      {
        exportType: `${TYPE}-adif`,
        templateData: { activity: contestId(args.operation) },
        format: 'adif',
        label: t('adifExport', { contest: manifest.shortName }),
        filename: named('adi'),
        selectedByDefault: true,
        refType: TYPE,
      },
      {
        exportType: `${TYPE}-cabrillo`,
        templateData: { activity: contestId(args.operation) },
        format: 'cabrillo',
        label: t('cabrilloExport', { contest: manifest.shortName }),
        filename: named('log'),
        selectedByDefault: true,
        refType: TYPE,
      },
    ]
  },

  async generateExport(args: ExportRequest, _ctx: HookContext): Promise<ExportResult> {
    // Only the two exportTypes `suggestExportOptions` above offers. A hook that
    // answers for an exportType it never offered makes the ADIF delegation
    // recurse into itself.
    if (args.exportType !== `${TYPE}-cabrillo` && args.exportType !== `${TYPE}-adif`) {
      return { filename: '', mimeType: '', content: '' }
    }

    const operation = args.operation
    const opRef = refOfType(operation, TYPE)
    const ourCall = str(operation.stationCall)

    if (args.exportType === `${TYPE}-cabrillo`) {
      const profile = await profileDetails()
      const section = ourSection(opRef)
      const content = qsonToCabrillo(args.qsos, {
        headers: [
          ['CONTEST', contestId(operation)],
          ['CALLSIGN', ourCall],
          // The calls listed at setup — required for a multioperator entry —
          // else the app's own operator call.
          ['OPERATORS', declaredOperators(opRef) || str((operation.local as Record<string, JSONValue>)?.operatorCall)],
          // For an ARRL contest, LOCATION is the section.
          ['LOCATION', section],
          ...cabrilloCategories(opRef),
          ['GRID-LOCATOR', str(operation.grid)],
          ['CLUB', declaredClub(opRef) || profile.club],
          ['NAME', profile.name],
          ['EMAIL', profile.email],
        ],
        // After freq, mode, date and time, each side in the ARRL template's
        // column order — call, nr, prec, ck, sec:
        // `QSO: 14000 CW 2026-11-07 2100 W1AW 1 M 38 CT K8MM 1 Q 92 MI`.
        qsoParts: (qso) => {
          const ref = refOfType(qso, TYPE)
          return [
            ourCall || '-',
            serial(qso, 'ourSerial') || '0',
            ourPrecedence(opRef) || '-',
            ourCheck(opRef) || '-',
            section || '-',
            str(((qso.their as Record<string, JSONValue>) ?? {}).call) || '-',
            serial(qso, 'theirSerial') || '0',
            asTyped(ref?.theirPrecedence, normalizePrecedence(ref?.theirPrecedence)) || '-',
            asTyped(ref?.theirCheck, normalizeCheck(ref?.theirCheck)) || '-',
            asTyped(ref?.theirSection, normalizeSection(ref?.theirSection)) || '-',
          ]
        },
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
      // extension's `adifFields` hook and no other's.
      mainHandler: manifest.key,
    })
    return {
      filename: filenameFor(operation, args.qsos, 'adi', args.compactFilenames),
      mimeType: 'text/plain',
      content,
    }
  },
}

/// N1MM's call history file for one weekend, by the stem its updates share.
/// Kept a week: the contributor updates it around each running, and a stale
/// copy only costs a suggestion.
function historyDataFile(mode: SSMode): DataFileDefinition {
  return {
    key: `${manifest.key}-${HISTORY_STEMS[mode].toLowerCase()}`,
    name: (_args: Record<string, never>, ctx: HookContext) => {
      const t = tFor(ctx)
      return t('historyFileName', { mode: t(`mode_${mode}`) })
    },
    description: (_args: Record<string, never>, ctx: HookContext) => tFor(ctx)('historyFileDescription'),
    url: `n1mm-history:${HISTORY_STEMS[mode]}`,
    maxAgeInDays: 7,
    fetchType: 'raw',
    category: 'ss',
    rawToJSONData: async ({ body }) => parseHistory(body),
    onLoadRawData: (data) => loadHistory(mode, data),
    onRemoveRawData: async () => removeHistory(mode),
  }
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    for (const mode of MODES) {
      const file = historyDataFile(mode)
      registerHook('dataFile', { hook: file, key: file.key })
    }
    registerHook('activity', { hook: ActivityHook, key: manifest.key })
    registerHook(`ref:${TYPE}`, { hook: RefHandler, key: manifest.key })
    registerHook('adifFields', { hook: AdifFieldsHook, key: manifest.key })
    registerHook('export', { hook: ExportHook, key: manifest.key })
    registerHook('scoring', {
      hook: contestScorer(SSScorer, { scope: { refTypes: [TYPE] } }),
      key: manifest.key,
    })
  },
})
