// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// North American SSB Sprint — new here; app-polo never had it. Written from
// the sponsor's rules (ssbsprint.com/rules) and Cabrillo page
// (ssbsprint.com/submit-log-cabrillo).
//
// Four hours, three bands, and an exchange of both calls, a serial, a name
// and a location: "KA9FOX 122 BILL FL K4XS". Ours comes from the setup — the
// serial counts itself — and theirs is three fields per QSO, the name and
// location guessed from N1MM's Sprint call history and the callsign lookup.

import { exportTypeDefinition } from "@ham2k/extension-sdk"
import { qsonToCabrillo } from "@ham2k/lib-qson-cabrillo"
import { rulesNotes, withRules } from "@ham2k/lib-contest-rules"
import { stampedExchange } from "@ham2k/lib-contest-exchange"
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
import { OPERATOR_CLASSES, POWER_CLASSES, cabrilloCategories, contestRules } from "./entry.ts"
import { TYPE, guessedLocation, guessedName, ourExchange, refOfType, serial, serialOf, str, theirExchange } from "./exchange.ts"
import { HISTORY_STEM, firstName, loadHistory, parseHistory, removeHistory } from "./history.ts"
import { LOCATION_PATTERN, VALID_LOCATIONS, normalizeLocation } from "./locations.ts"
import { nextContestDate, relevanceFor } from "./schedule.ts"
import { CONTEST_TITLE, SprintScorer } from "./scorer.ts"

import manifest from "../manifest.json" with { type: "json" }

/// The Cabrillo CONTEST line and ADIF CONTEST_ID — "DO NOT PUT THE YEAR OR
/// USE PH INSTEAD OF SSB."
const CONTEST_ID = 'NA-SPRINT-SSB'

/// Every location the Sprint knows, for the setup's own.
const LOCATION_SUGGESTIONS = [...VALID_LOCATIONS].sort().map((code) => ({ code }))

/// The words a search can be made of. Every word typed has to be one of
/// these, in any order — "sprint ssb", "na ssb sprint" — or, from three
/// letters on, the start of one: "SS" is Sweepstakes, not the start of SSB.
/// A year is ignored, since the dates tell the runnings apart.
const SEARCH_WORDS = ['NORTH', 'AMERICAN', 'NA', 'SSB', 'PHONE', 'SPRINT', 'NA-SPRINT-SSB']

function searchMatches(term: string): boolean {
  const words = term.split(/\s+/).filter((word) => word && !/^\d+$/.test(word))
  return words.length > 0 && words.every((word) => SEARCH_WORDS.some((known) => known === word || (word.length >= 3 && known.startsWith(word))))
}

/// The operator's first name from their profile, for the setup form's
/// `value`. STICKY ON FAILURE, as in `arrl-ss`: the form re-applies a field's
/// `value` when a re-fetched definition disagrees with the previous one, so a
/// host that answers once and then cannot must not blank the name in front of
/// the operator.
let lastKnownName = ''

async function ourNameDefault(): Promise<string> {
  try {
    const settings = (await host.getSettings()) as Record<string, JSONValue> | undefined
    lastKnownName = firstName(settings?.operatorName)
  } catch (e) {
    console.warn(`[${TYPE}] profile settings unavailable, keeping the last name read:`, e)
  }
  return lastKnownName
}

/// The operator's name and email from their profile, for the Cabrillo header.
/// A host that cannot answer costs these lines, never the log itself.
async function profileDetails(): Promise<{ name: string; email: string }> {
  try {
    const settings = (await host.getSettings()) as Record<string, JSONValue> | undefined
    const line = (value: JSONValue | undefined) => str(value).replace(/\s+/g, ' ').trim()
    return { name: line(settings?.operatorName), email: line(settings?.operatorEmail) }
  } catch (e) {
    console.warn(`[${TYPE}] profile settings unavailable, exporting without profile name and email:`, e)
    return { name: '', email: '' }
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
  return [select('operator', OPERATOR_CLASSES), select('power', POWER_CLASSES)]
}

const ActivityHook = {
  /// Offered in the activity search by NAME and by NEARNESS. Nothing is
  /// offered to an operation that already runs the Sprint: a tapped
  /// suggestion would REPLACE the configured ref and lose its setup.
  async suggest({ operation, searchTerm }: SuggestArgs, ctx: HookContext): Promise<ActivitySuggestion[]> {
    if (refOfType(operation, TYPE)) return []
    const t = tFor(ctx)
    const term = (searchTerm ?? '').trim().toUpperCase()
    if (term && !searchMatches(term)) return []

    const now = Date.now()
    return [{
      type: TYPE,
      // A suggestion is persisted VERBATIM and never runs through
      // `decorateRef`, so everything the operation row reads has to be here,
      // and the labels must match what `decorateRef` composes.
      program: 'Contest',
      name: `${t('activityDescription')} • ${nextContestDate(now)}`,
      label: CONTEST_TITLE,
      shortLabel: CONTEST_TITLE,
      relevance: relevanceFor(now),
    }]
  },

  async operationControls(
    _args: { operation: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<LoggingControlDescriptor[]> {
    const t = tFor(ctx)
    const profileName = await ourNameDefault()
    return [
      {
        key: `${TYPE}/setup`,
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
              // `ourName`/`ourLocation`, not `name`/`location`: a form field
              // key IS a key on the ref, and `name` is the slot `decorateRef`
              // writes the activity row's subtitle into.
              {
                type: 'field',
                fieldType: 'text',
                key: 'ourName',
                label: t('ourNameLabel'),
                placeholder: t('ourNamePlaceholder'),
                uppercase: true,
                value: profileName,
              },
              {
                type: 'field',
                fieldType: 'text',
                key: 'ourLocation',
                label: t('ourLocationLabel'),
                placeholder: t('ourLocationPlaceholder'),
                uppercase: true,
                // It is sent on every contact and heads the Cabrillo file, so
                // a value the Sprint doesn't know is flagged as it is typed.
                suggestions: LOCATION_SUGGESTIONS,
              },
              // What the rules allow, following the entry below.
              ...rulesNotes(ctx, 'operator', OPERATOR_CLASSES, contestRules),
              // The entry we are making, for the Cabrillo header. Each starts
              // undeclared: see entry.ts.
              ...entrySelects(t),
              { type: 'markdown', text: t('qsyReminder') },
              { type: 'markdown', text: t('rulesLink') },
            ],
          },
        },
      },
    ]
  },

  /// Our serial, then the three things they send, in the order they send
  /// them: "122 BILL FL".
  ///
  /// Ours is a `serial` input — the extension names the sequence and the core
  /// fills the field — out of the Space and Tab cycle, since nobody types it.
  async loggingControls(
    args: { operation: Record<string, JSONValue>; qso?: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<LoggingControlDescriptor[]> {
    // Off-contest, contribute nothing. The core already refuses a primary field
    // to an activity the operation isn't running; this saves the work.
    if (!refOfType(args.operation, TYPE)) return []

    const t = tFor(ctx)
    const their = (args.qso?.their as Record<string, JSONValue>) ?? {}
    const name = guessedName(their)
    const location = guessedLocation(their)
    const control = (key: string, label: string, order: number) => ({
      key: `${TYPE}/${key}`,
      label: t(label),
      icon: manifest.icon,
      color: manifest.accentColor,
      order,
    })

    return [
      {
        ...control('ourSerial', 'ourSerialLabel', 10),
        skipFocus: true,
        input: { kind: 'serial', refType: TYPE, field: 'ourSerial', sequence: { key: 'serial' } },
      },
      // No guess for their serial: there is nothing to go on for a number
      // another station is about to send.
      { ...control('theirSerial', 'theirSerialLabel', 20), input: { kind: 'text', refType: TYPE, field: 'theirSerial', numeric: true, maxLength: 5 } },
      {
        ...control('name', 'nameLabel', 30),
        input: {
          kind: 'text',
          refType: TYPE,
          field: 'name',
          maxLength: 12,
          uppercase: true,
          placeholder: name || undefined,
          suggestedValue: name || undefined,
        },
      },
      {
        ...control('location', 'locationLabel', 40),
        input: {
          kind: 'text',
          refType: TYPE,
          field: 'location',
          maxLength: 4,
          uppercase: true,
          pattern: LOCATION_PATTERN,
          placeholder: location || undefined,
          suggestedValue: location || undefined,
        },
      },
    ] as LoggingControlDescriptor[]
  },

  /// Records what was received, and mirrors it where the rest of the app can
  /// see it: our serial into `our.exchange` (the part of ours that varies),
  /// theirs whole into `their.exchange`.
  ///
  /// The name and location are guessable, so a guess is written onto the ref
  /// as data of record rather than left for the export to re-derive. The typed
  /// value always wins, and a field the operator emptied on purpose — present
  /// on the ref as '' — stays empty rather than being guessed over.
  async processQsoBeforeSave(
    args: { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> },
    _ctx: HookContext,
  ): Promise<Record<string, JSONValue> | null> {
    if (!refOfType(args.operation, TYPE)) return null

    const their = (args.qso.their as Record<string, JSONValue>) ?? {}
    const qsoRef = refOfType(args.qso, TYPE)
    const received = stampedExchange(TYPE, qsoRef, {
      // Read into the exchange as typed, and left on the ref as typed.
      theirSerial: { read: serialOf, stamp: false },
      name: { read: firstName, guess: () => guessedName(their) },
      location: { read: normalizeLocation, guess: () => guessedLocation(their) },
    }, ({ theirSerial, name, location }) => [theirSerial, name, location].filter((part) => part).join(' '))

    // Ours only once the core has allocated it: the second and later calls of
    // a call list get theirs after this hook runs, and '' would blank the cell.
    const ourSerial = serial(qsoRef, 'ourSerial')
    return ourSerial ? { ...received, our: { exchange: ourSerial } } : received
  },
}

const RefHandler = {
  async validateRef({ ref }: { ref: Ref }, _ctx: HookContext) {
    return { valid: true, normalized: (ref.ref ?? '').trim() }
  },

  async decorateRef({ ref }: { ref: Ref }, ctx: HookContext): Promise<Ref> {
    const t = tFor(ctx)
    const { name, location } = ourExchange(ref as Record<string, JSONValue>)
    const decorated = {
      ...ref,
      program: 'Contest',
      label: CONTEST_TITLE,
      shortLabel: CONTEST_TITLE,
      name: [name, location].filter((x) => x).join(' ') || t('notConfigured'),
    }
    return withRules(decorated, contestRules((ref as Record<string, JSONValue>).operator))
  },

  /// "KI2D for SSB Sprint" with "SEB in NY" beneath it: the sent exchange is
  /// the one thing an operator re-reads constantly during a contest.
  async suggestOperationTitle({ ref }: { ref: Ref; operation: Record<string, JSONValue> }, ctx: HookContext) {
    const { name, location } = ourExchange(ref as Record<string, JSONValue>)
    return {
      for: CONTEST_TITLE,
      subtitle: name && location ? tFor(ctx)('ourExchangeSubtitle', { name, location }) : undefined,
    }
  },

  async linkForRef(_args: { ref: Ref }, _ctx: HookContext): Promise<RefLink | null> {
    return { url: 'https://ssbsprint.com/rules/', label: 'SSB Sprint' }
  },
}

const AdifFieldsHook = {
  async fieldsForOneQSO(
    { qso, operation }: { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> },
    _ctx: HookContext,
  ): Promise<{ name: string; value: string }[]> {
    const opRef = refOfType(operation, TYPE)
    if (!opRef) return []
    const qsoRef = refOfType(qso, TYPE)
    const ours = ourExchange(opRef)

    const fields: { name: string; value: string }[] = [{ name: 'CONTEST_ID', value: CONTEST_ID }]
    const add = (name: string, value: string) => {
      if (value) fields.push({ name, value })
    }
    add('STX', serial(qsoRef, 'ourSerial'))
    add('SRX', serial(qsoRef, 'theirSerial'))
    add('STX_STRING', [serial(qsoRef, 'ourSerial'), ours.name, ours.location].filter((part) => part).join(' '))
    add('SRX_STRING', theirExchange(qsoRef))
    return fields
  },
}

/// "If possible, name the file CALLSIGN.LOG" (14a) — the default the export
/// settings start from, editable like any other.
const CABRILLO_FILENAME = '{{ log.station | dash }}'

function cabrilloFilename(operation: Record<string, JSONValue>): string {
  return `${str(operation.stationCall).toUpperCase().replace(/\//g, '-') || 'UNKNOWN'}.log`
}

function adifFilename(operation: Record<string, JSONValue>, qsos: Record<string, JSONValue>[], compact?: boolean): string {
  return exportFilename({
    stationCall: operation.stationCall,
    activity: CONTEST_ID,
    startAtMillis: startMillisOf(operation, qsos),
    extension: 'adi',
    compact,
  })
}

const ExportHook = {
  async getExportTypes() {
    return [
      exportTypeDefinition(TYPE, 'adif', manifest.shortName),
      exportTypeDefinition(TYPE, 'cabrillo', manifest.shortName, {
        filenameTemplate: CABRILLO_FILENAME,
        compactFilenameTemplate: CABRILLO_FILENAME,
      }),
    ]
  },

  async suggestExportOptions(args: ExportOptionsRequest, ctx: HookContext): Promise<ExportOption[]> {
    if (!refOfType(args.operation, TYPE)) return []
    const t = tFor(ctx)
    return [
      {
        exportType: `${TYPE}-adif`,
        templateData: { activity: CONTEST_ID },
        format: 'adif',
        label: t('adifExport', { contest: manifest.shortName }),
        filename: adifFilename(args.operation, args.qsos ?? [], args.compactFilenames),
        selectedByDefault: true,
        refType: TYPE,
      },
      {
        exportType: `${TYPE}-cabrillo`,
        templateData: { activity: CONTEST_ID },
        format: 'cabrillo',
        label: t('cabrilloExport', { contest: manifest.shortName }),
        filename: cabrilloFilename(args.operation),
        selectedByDefault: true,
        refType: TYPE,
      },
    ]
  },

  async generateExport(args: ExportRequest, _ctx: HookContext): Promise<ExportResult> {
    // Only the two exportTypes offered above. A hook answering for an
    // exportType it never offered makes the ADIF delegation recurse into
    // itself.
    if (args.exportType !== `${TYPE}-cabrillo` && args.exportType !== `${TYPE}-adif`) {
      return { filename: '', mimeType: '', content: '' }
    }

    const operation = args.operation
    const opRef = refOfType(operation, TYPE)
    const ourCall = str(operation.stationCall)
    const ours = ourExchange(opRef)

    if (args.exportType === `${TYPE}-cabrillo`) {
      const profile = await profileDetails()
      // Only the fields the sponsor's Cabrillo page shows: "The SSB Sprint
      // Contest only recognizes the Cabrillo fields shown on this page."
      const content = qsonToCabrillo(args.qsos, {
        headers: [
          ['CALLSIGN', ourCall],
          ['CONTEST', CONTEST_ID],
          ...cabrilloCategories(opRef),
          ['LOCATION', ours.location],
          ['NAME', profile.name || ours.name],
          ['EMAIL', profile.email],
          // Single operator only: the one at the microphone.
          ['OPERATORS', str((operation.local as Record<string, JSONValue>)?.operatorCall) || ourCall],
        ],
        // After freq, mode, date and time: call, nr, name and location sent,
        // then received — `QSO: 14240 PH 2020-11-01 0001 KA9FOX 5 SCOTT WI N3QE 2 TIM MD`.
        qsoParts: (qso) => {
          const qsoRef = refOfType(qso, TYPE)
          return [
            ourCall || '-',
            serial(qsoRef, 'ourSerial') || '0',
            ours.name || '-',
            ours.location || '-',
            str(((qso.their as Record<string, JSONValue>) ?? {}).call) || '-',
            serial(qsoRef, 'theirSerial') || '0',
            firstName(qsoRef?.name) || '-',
            normalizeLocation(qsoRef?.location) || '-',
          ]
        },
      })
      return { filename: cabrilloFilename(operation), mimeType: 'text/plain', content }
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
      filename: adifFilename(operation, args.qsos, args.compactFilenames),
      mimeType: 'text/plain',
      content,
    }
  },
}

/// N1MM's Sprint call history. Kept a week: the contributor updates it
/// around each running, and a stale copy only costs a suggestion.
const HistoryDataFile: DataFileDefinition = {
  key: `${manifest.key}-history`,
  name: (_args: Record<string, never>, ctx: HookContext) => tFor(ctx)('historyFileName'),
  description: (_args: Record<string, never>, ctx: HookContext) => tFor(ctx)('historyFileDescription'),
  url: `n1mm-history:${HISTORY_STEM}`,
  maxAgeInDays: 7,
  fetchType: 'raw',
  category: TYPE,
  rawToJSONData: async ({ body }) => parseHistory(body),
  onLoadRawData: (data) => loadHistory(data),
  onRemoveRawData: async () => removeHistory(),
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook('dataFile', { hook: HistoryDataFile, key: HistoryDataFile.key })
    registerHook('activity', { hook: ActivityHook, key: manifest.key })
    registerHook(`ref:${TYPE}`, { hook: RefHandler, key: manifest.key })
    registerHook('adifFields', { hook: AdifFieldsHook, key: manifest.key })
    registerHook('export', { hook: ExportHook, key: manifest.key })
    registerHook('scoring', {
      hook: contestScorer(SprintScorer, { scope: { refTypes: [TYPE] } }),
      key: manifest.key,
    })
  },
})
