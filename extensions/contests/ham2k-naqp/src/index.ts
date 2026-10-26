// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// North American QSO Party. Ported from app-polo's NAQPExtension.
//
// What it exercises that
// the other contests don't: TWO primary fields writing to one ref — NAQP sends
// a name
// and a location, and both are typed on every QSO.
//
// Its location set is inline (`locations.ts`), per docs/design/contests.md
// §5.3's dataset table.

import { exportTypeDefinition } from "@ham2k/extension-sdk"
import { qsonToCabrillo } from "@ham2k/lib-qson-cabrillo"
import { stampedExchange } from "@ham2k/lib-contest-exchange"
import { adifForExport, annotateCallAgainstCountryFile, contestScorer, defineExtension, exportFilename, host, startMillisOf } from "@ham2k/extension-sdk"
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

import { tFor } from "./i18n.ts"
import { OPERATOR_CLASSES, POWER_CLASSES, cabrilloCategories, declaredOperators } from "./entry.ts"
import { firstName, guessedLocation, guessedName, normalizeLocation, ourExchange } from "./exchange.ts"
import { LOCATION_PATTERN, VALID_LOCATIONS } from "./locations.ts"
import { MODES, nearestMode, nextContestDate, relevanceFor } from "./schedule.ts"
import { NAQPScorer, contestTitle } from "./scorer.ts"

import manifest from "../manifest.json" with { type: "json" }

/// The ref type an operation stores. It is data in the operator's log, so it
/// stays what the app's own built-in wrote there whatever this package is
/// called: the manifest key names the package, `TYPE` names the activation.
const TYPE = 'naqp'

/// What a search has to contain to offer these contests. Matched as "does the
/// alias contain what was typed", so "qso party" finds them among the state
/// parties and the date ranking decides which mode comes first.
const ALIASES = ['NAQP', 'NORTH AMERICAN QSO PARTY']

function refOfType(container: Record<string, JSONValue>, type: string): Record<string, JSONValue> | undefined {
  return (((container.refs as Record<string, JSONValue>[] | undefined) ?? [])).find((r) => r?.type === type)
}

function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

/// The operator's name and email from their profile, for the Cabrillo header.
/// Both optional and free-form in the profile, so each may be ''. A host that
/// cannot answer costs these lines, never the log itself.
async function profileDetails(): Promise<{ name: string; email: string }> {
  try {
    const settings = (await host.getSettings()) as Record<string, JSONValue> | undefined
    const line = (value: JSONValue | undefined) => str(value).replace(/\s+/g, ' ').trim()
    return { name: line(settings?.operatorName), email: line(settings?.operatorEmail) }
  } catch (e) {
    console.warn(`[naqp] profile settings unavailable, exporting without profile name and email:`, e)
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
  /// Offered in the activity search by NAME and by NEARNESS — all three
  /// modes, each ranked by its own next running, so in January CW leads and
  /// in February RTTY.
  ///
  /// Nothing is offered to an operation that already runs NAQP: as in CQ WW,
  /// the mode lives on the ref as `mode`, not `ref`, so the picker's duplicate
  /// guard would let a tapped suggestion REPLACE the configured ref and lose
  /// the name and location set up on it.
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
      // The date is what tells the runnings apart at a glance — the same
      // `description • date` line the QSO parties show.
      name: `${t('activityDescription')} • ${nextContestDate(now, mode)}`,
      label: `NAQP ${mode}`,
      shortLabel: `NAQP ${mode}`,
      relevance: relevanceFor(now, mode),
    }))
  },

  async operationControls(
    _args: { operation: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<LoggingControlDescriptor[]> {
    const t = tFor(ctx)
    return [
      {
        key: 'naqp/setup',
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
                // NAQP runs these as separate contests on separate weekends.
                options: [{ value: 'CW', label: 'CW' }, { value: 'SSB', label: 'SSB' }, { value: 'RTTY', label: 'RTTY' }],
              },
              // `ourName`/`ourLocation`, not `name`/`location`: a form field
              // key IS a key on the ref, and `name` is the slot `decorateRef`
              // writes the activity row's subtitle into. Naming them plainly
              // would have this setup overwrite itself on save.
              {
                type: 'field',
                fieldType: 'text',
                key: 'ourName',
                label: t('ourNameLabel'),
                placeholder: t('ourNamePlaceholder'),
                uppercase: true,
              },
              {
                type: 'field',
                fieldType: 'text',
                key: 'ourLocation',
                label: t('ourLocationLabel'),
                placeholder: t('ourLocationPlaceholder'),
                uppercase: true,
              },
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
              { type: 'markdown', text: t('rulesLink') },
            ],
          },
        },
      },
    ]
  },

  /// TWO fields per QSO — the first contest here to need that. Both write to
  /// the same ref, which the core folds together.
  ///
  /// Both are UPPERCASE. §5.3 cites this name field as its worked example of
  /// where `uppercase: false` belongs, and that is wrong for an on-air
  /// exchange: an operator not reaching for shift logs "bob", and a Cabrillo
  /// full of mixed-case names reads as sloppy. polo forces uppercase here too.
  async loggingControls(
    args: { operation: Record<string, JSONValue>; qso?: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<LoggingControlDescriptor[]> {
    // Off-contest, contribute nothing — an optimization, not the rule. The core
    // already refuses a primary field to an activity the operation isn't
    // running; what this saves is a country-file annotation per refresh.
    if (!refOfType(args.operation, TYPE)) return []

    const t = tFor(ctx)
    const their = ((args.qso?.their as Record<string, JSONValue>) ?? {})
    const name = guessedName(their)
    const location = guessedLocation(their)

    return [
      {
        key: 'naqp/name',
        label: t('nameLabel'),
        icon: manifest.icon,
        color: manifest.accentColor,
        order: 10,
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
        key: 'naqp/location',
        label: t('locationLabel'),
        icon: manifest.icon,
        color: manifest.accentColor,
        order: 20,
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
    ]
  },

  /// Records what was received, and mirrors it where the rest of the app can
  /// see it (docs/design/contests.md §8).
  ///
  /// Both halves of the exchange are guessable — the name from the callsign
  /// lookup, the location from the country file — so both are written onto the
  /// ref as data of record rather than left for the export to re-derive. The
  /// typed value always wins.
  async processQsoBeforeSave(
    args: { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> },
    _ctx: HookContext,
  ): Promise<Record<string, JSONValue> | null> {
    if (!refOfType(args.operation, TYPE)) return null
    const their = ((args.qso.their as Record<string, JSONValue>) ?? {})
    return stampedExchange(TYPE, refOfType(args.qso, TYPE), {
      name: { read: firstName, guess: () => guessedName(their) },
      location: { read: normalizeLocation, guess: () => guessedLocation(their) },
    }, ({ name, location }) => [name, location].filter((x) => x).join(' '))
  },
}

const RefHandler = {
  async validateRef({ ref }: { ref: Ref }, _ctx: HookContext) {
    return { valid: true, normalized: (ref.ref ?? '').trim() }
  },

  async decorateRef({ ref }: { ref: Ref }, ctx: HookContext): Promise<Ref> {
    const mode = str((ref as Record<string, JSONValue>).mode)
    const label = mode ? `NAQP ${mode}` : tFor(ctx)('unconfigured')
    const { name, location } = ourExchange(ref as Record<string, JSONValue>)
    return {
      ...ref,
      program: 'Contest',
      label,
      shortLabel: label,
      name: [name, location].filter((x) => x).join(' ') || tFor(ctx)('notConfigured'),
    }
  },

  /// "KI2D for NAQP CW" with "SEB in NY" beneath it: the sent exchange is the
  /// one thing an operator re-reads constantly during a contest.
  async suggestOperationTitle(
    { ref }: { ref: Ref; operation: Record<string, JSONValue> },
    ctx: HookContext,
  ) {
    const { name, location } = ourExchange(ref as Record<string, JSONValue>)
    return {
      for: contestTitle(ref as Record<string, JSONValue>),
      subtitle: name && location ? tFor(ctx)('ourExchangeSubtitle', { name, location }) : undefined,
    }
  },

  /// The contest's published rules — a reference here names an event, not a
  /// place, so what there is to read about it is the rules it is run under.
  async linkForRef(_args: { ref: Ref }, _ctx: HookContext): Promise<RefLink | null> {
    return { url: 'https://ncjweb.com/naqp/', label: 'NAQP' }
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
      { name: 'CONTEST_ID', value: mode ? `NAQP-${mode}` : 'NAQP' },
    ]
    const ours = ourExchange(opRef)
    const qsoRef = refOfType(qso, TYPE)
    const sent = [ours.name, ours.location].filter((x) => x).join(' ')
    const received = [firstName(qsoRef?.name), normalizeLocation(qsoRef?.location)].filter((x) => x).join(' ')
    if (sent) fields.push({ name: 'STX_STRING', value: sent })
    if (received) fields.push({ name: 'SRX_STRING', value: received })
    return fields
  },
}

function reportFor(qso: Record<string, JSONValue>, side: 'our' | 'their'): string {
  const sideData = (qso[side] as Record<string, JSONValue>) ?? {}
  const sent = str(sideData.sent)
  if (sent) return sent
  return str(qso.mode) === 'CW' || str(qso.mode) === 'RTTY' ? '599' : '59'
}

/// The contest's own name for this operation's file — the mode is part of the
/// identity here, since NAQP CW and NAQP SSB are separate contests with
/// separate submissions. Same string the Cabrillo and ADIF headers carry.
function contestTag(operation: Record<string, JSONValue>): string {
  const mode = str(refOfType(operation, TYPE)?.mode)
  return mode ? `NAQP-${mode}` : 'NAQP'
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
    // Only the two exportTypes offered above. Belt and braces alongside the
    // keyed delegation in `adifForExport`: a hook answering for an exportType it never
    // offered makes the ADIF delegation recurse into itself.
    if (args.exportType !== `${TYPE}-cabrillo` && args.exportType !== `${TYPE}-adif`) {
      return { filename: '', mimeType: '', content: '' }
    }

    const operation = args.operation
    const opRef = refOfType(operation, TYPE)
    const mode = str(opRef?.mode)
    const ourCall = str(operation.stationCall)
    const ours = ourExchange(opRef)

    if (args.exportType === `${TYPE}-cabrillo`) {
      const profile = await profileDetails()
      const content = qsonToCabrillo(args.qsos, {
        headers: [
          ['CONTEST', mode ? `NAQP-${mode}` : 'NAQP'],
          ['CALLSIGN', ourCall],
          // The calls listed at setup, else the app's own operator call.
          ['OPERATORS', declaredOperators(opRef) || str((operation.local as Record<string, JSONValue>)?.operatorCall)],
          ['LOCATION', ours.location],
          ...cabrilloCategories(opRef),
          ['GRID-LOCATOR', str(operation.grid)],
          // The sponsor's template has the operator's full name here, which
          // the profile holds; the name we send stands in without one.
          ['NAME', profile.name || ours.name],
          ['EMAIL', profile.email],
        ],
        qsoParts: (qso) => {
          const qsoRef = refOfType(qso, TYPE)
          return [
            ourCall || '-',
            ours.name || '-',
            ours.location || '-',
            str(((qso.their as Record<string, JSONValue>) ?? {}).call) || '-',
            firstName(qsoRef?.name) || '-',
            normalizeLocation(qsoRef?.location) || '-',
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
      hook: contestScorer(NAQPScorer, { scope: { refTypes: [TYPE] } }),
      key: manifest.key,
    })
  },
})

// `VALID_LOCATIONS` is re-exported for the tests, which check the dataset
// itself rather than reaching through the scorer for it.
export { VALID_LOCATIONS }
