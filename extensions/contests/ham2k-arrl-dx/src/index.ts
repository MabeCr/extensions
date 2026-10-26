// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// ARRL International DX Contest. Ported from app-polo's ARRLDXExtension.
//
// The dynamic side of the input catalog in action: this contest's single
// exchange field is a state/province OR a power level depending on which side
// of the contest we're on — different label, different validation, same
// control. `loggingControls` gets the operation, so the descriptor is just
// computed per call; nothing in the core is needed to support it.

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

import { tFor } from "./i18n.ts"
import { cabrilloLocation, normalizeSection } from "./location.ts"
import { MODES, nearestMode, nextContestDate, relevanceFor } from "./schedule.ts"
import { ARRLDXScorer, POWER_PATTERN, contestTitle, isWveCall, weAreWve } from "./scorer.ts"
import { BAND_CLASSES, OPERATOR_CLASSES, POWER_CLASSES, cabrilloCategories, contestRules, declaredClub, declaredOperators } from "./entry.ts"

import manifest from "../manifest.json" with { type: "json" }

/// The ref type an operation stores. It is data in the operator's log, so it
/// stays what the app's own built-in wrote there whatever this package is
/// called: the manifest key names the package, `TYPE` names the activation.
const TYPE = 'arrl-dx'

/// What a search has to contain to offer these contests. Matched as "does the
/// alias contain what was typed", so "arrl" finds them and the date ranking
/// decides which running comes first.
const ALIASES = ['ARRL DX', 'ARRLDX', 'ARRL INTERNATIONAL DX', 'INTERNATIONAL DX']

function refOfType(container: Record<string, JSONValue>, type: string): Record<string, JSONValue> | undefined {
  return (((container.refs as Record<string, JSONValue>[] | undefined) ?? [])).find((r) => r?.type === type)
}

function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

/// Our section from the operator's profile, for the setup form's `value`.
/// STICKY ON FAILURE, as in `arrl-ss`: the form re-applies a field's value
/// whenever it is rebuilt, so a host that answers once and then fails must not
/// blank the field in front of the operator.
let lastKnownSection = ''

async function ourSectionDefault(): Promise<string> {
  try {
    const settings = (await host.getSettings()) as Record<string, JSONValue> | undefined
    lastKnownSection = normalizeSection(settings?.operatorSection)
  } catch (e) {
    console.warn(`[arrl-dx] profile settings unavailable, keeping the last section read:`, e)
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
    console.warn(`[arrl-dx] profile settings unavailable, exporting without name, email and profile club:`, e)
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
  ]
}

const ActivityHook = {
  /// Offered in the activity search by NAME and by NEARNESS — both runnings,
  /// each ranked by its own weekend, so in February CW leads and after it
  /// Phone.
  ///
  /// Nothing is offered to an operation that already runs ARRL DX: as in CQ
  /// WW, the mode lives on the ref as `mode`, not `ref`, so the picker's
  /// duplicate guard would let a tapped suggestion REPLACE the configured ref
  /// and lose its exchange.
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
      label: `ARRL DX ${mode}`,
      shortLabel: `ARRL DX ${mode}`,
      relevance: relevanceFor(now, mode),
    }))
  },

  async operationControls(
    args: { operation: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<LoggingControlDescriptor[]> {
    const t = tFor(ctx)
    const ref = refOfType(args.operation, TYPE)
    const ours = weAreWve(args.operation, ref)

    return [
      {
        key: 'arrl-dx/setup',
        // See CQ WW: the Activity Types list names the contest family.
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
                options: [{ value: 'CW', label: 'CW' }, { value: 'Phone', label: 'Phone' }],
              },
              {
                type: 'field',
                fieldType: 'radio',
                key: 'stationType',
                label: t('stationTypeLabel'),
                // Pre-answered from our own callsign; the operator only has to
                // touch it when they're operating from somewhere unexpected.
                options: [
                  { value: 'wve', label: t('stationTypeWve') },
                  { value: 'dx', label: t('stationTypeDx') },
                ],
              },
              {
                type: 'field',
                fieldType: 'text',
                key: 'exchange',
                // What we send is the other half of the asymmetry: a W/VE
                // station sends its state, a DX station sends its power.
                label: ours ? t('ourStateLabel') : t('ourPowerLabel'),
                placeholder: ours ? t('ourStatePlaceholder') : t('ourPowerPlaceholder'),
                uppercase: true,
              },
              // What the rules allow, following the operator class below.
              ...rulesNotes(ctx, 'operator', OPERATOR_CLASSES, contestRules),
              // The entry we are making, for the Cabrillo header. Each starts
              // undeclared: see entry.ts.
              ...entrySelects(t),
              // For the Cabrillo LOCATION, US and Canadian stations only.
              {
                type: 'field',
                fieldType: 'text',
                key: 'section',
                label: t('ourSectionLabel'),
                placeholder: t('ourSectionPlaceholder'),
                uppercase: true,
                value: await ourSectionDefault(),
              },
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

  /// One field, two meanings. We receive power from a DX station and a
  /// state/province from a W/VE one — so both the label and the validation
  /// follow whichever side we're on.
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
    const ref = refOfType(args.operation, TYPE)
    if (!ref) return []

    const t = tFor(ctx)
    const ours = weAreWve(args.operation, ref)

    const their = ((args.qso?.their as Record<string, JSONValue>) ?? {})
    const guess = (their.guess as Record<string, JSONValue>) ?? {}
    // Only worth hinting the state side: nothing can predict a power level.
    const stateHint = str(their.state) || str(guess.state)

    return [
      {
        key: 'arrl-dx/exchange',
        label: ours ? t('theirPowerLabel') : t('theirStateLabel'),
        icon: manifest.icon,
        color: manifest.accentColor,
        order: 10,
        input: {
          kind: 'text',
          refType: TYPE,
          field: 'theirExchange',
          // A W/VE station receives power, which is validated; a DX station
          // receives a state or province, which is not — the sections and
          // abbreviations in use are broader than a pattern should presume.
          // No informational placeholder: nothing can guess a power level, and
          // the state hint only shows when the lookup actually produced one.
          ...(ours
            ? { pattern: POWER_PATTERN, maxLength: 4 }
            : { placeholder: stateHint || undefined, maxLength: 4 }),
        },
      },
    ]
  },

  /// Mirrors the exchange this contest keeps on its own ref into the generic
  /// `their.exchange`. Nothing outside this extension knows to look inside a
  /// contest ref, so without this the QSO row's exchange column and a plain
  /// (non-contest) ADIF export both come up empty on a contest log.
  ///
  /// Only ever a projection: the ref stays the source of truth, and the patch
  /// touches exactly one field.
  async processQsoBeforeSave(
    args: { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> },
    _ctx: HookContext,
  ): Promise<Record<string, JSONValue> | null> {
    if (!refOfType(args.operation, TYPE)) return null
    // their state/province or power, whichever side we are on
    const qsoRef = refOfType(args.qso, TYPE)
    const exchange = str(qsoRef?.theirExchange)
    // A field the operator EMPTIED is present-but-blank rather than absent (see
    // `_refsWithTextValues`). Returning null there would leave the previous
    // save's `their.exchange` showing in the QSO row and in a plain ADIF export,
    // so a cleared exchange has to project the blank.
    if (!exchange) return qsoRef && 'theirExchange' in qsoRef ? { their: { exchange: '' } } : null
    return { their: { exchange } }
  },
}

const RefHandler = {
  async validateRef({ ref }: { ref: Ref }, _ctx: HookContext) {
    return { valid: true, normalized: (ref.ref ?? '').trim() }
  },

  async decorateRef({ ref }: { ref: Ref }, ctx: HookContext): Promise<Ref> {
    const r = ref as Record<string, JSONValue>
    const mode = str(r.mode)
    const label = mode ? `ARRL DX ${mode}` : tFor(ctx)('unconfigured')
    const sent = str(r.exchange)
    const decorated = { ...ref, program: 'Contest', label, shortLabel: label, name: sent || tFor(ctx)('notConfigured') }
    return withRules(decorated, contestRules((ref as Record<string, JSONValue>).operator))
  },

  /// Same reasoning as CQ WW: what we send goes in the subtitle. For ARRL DX
  /// that's our state/province or our power, depending on which side we're on.
  async suggestOperationTitle(
    { ref }: { ref: Ref; operation: Record<string, JSONValue> },
    _ctx: HookContext,
  ) {
    const r = ref as Record<string, JSONValue>
    const sent = str(r.exchange)
    return {
      for: contestTitle(r),
      subtitle: sent || undefined,
    }
  },

  /// The contest's published rules — a reference here names an event, not a
  /// place, so what there is to read about it is the rules it is run under.
  async linkForRef(_args: { ref: Ref }, _ctx: HookContext): Promise<RefLink | null> {
    return { url: 'https://www.arrl.org/arrl-dx', label: 'ARRL DX' }
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
      { name: 'CONTEST_ID', value: mode === 'Phone' ? 'ARRL-DX-SSB' : mode ? `ARRL-DX-${mode}` : 'ARRL-DX' },
    ]
    const sent = str(opRef.exchange)
    const received = str(refOfType(qso, TYPE)?.theirExchange)
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
/// identity here, since ARRL DX CW and ARRL DX Phone are separate contests
/// with separate submissions.
function contestTag(operation: Record<string, JSONValue>): string {
  const mode = str(refOfType(operation, TYPE)?.mode)
  return `ARRL-DX-${mode || 'DX'}`
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
    const opRef = refOfType(operation, TYPE)
    const mode = str(opRef?.mode)
    const ourCall = str(operation.stationCall)

    if (args.exportType === `${TYPE}-cabrillo`) {
      const profile = await profileDetails()
      const content = qsonToCabrillo(args.qsos, {
        headers: [
          ['CONTEST', mode === 'Phone' ? 'ARRL-DX-SSB' : mode ? `ARRL-DX-${mode}` : 'ARRL-DX'],
          ['CALLSIGN', ourCall],
          // The calls listed at setup — required for a multioperator entry —
          // else the app's own operator call.
          ['OPERATORS', declaredOperators(opRef) || str((operation.local as Record<string, JSONValue>)?.operatorCall)],
          // Our section, or DX: see location.ts.
          ['LOCATION', cabrilloLocation(ourCall, opRef)],
          ...cabrilloCategories(opRef),
          ['GRID-LOCATOR', str(operation.grid)],
          // The club typed at setup, else the profile's.
          ['CLUB', declaredClub(opRef) || profile.club],
          ['NAME', profile.name],
          ['EMAIL', profile.email],
        ],
        qsoParts: (qso) => [
          ourCall || '-',
          reportFor(qso, 'our'),
          str(opRef?.exchange) || '-',
          str(((qso.their as Record<string, JSONValue>) ?? {}).call) || '-',
          reportFor(qso, 'their'),
          str(refOfType(qso, TYPE)?.theirExchange) || '-',
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

export { isWveCall }

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook('activity', { hook: ActivityHook, key: manifest.key })
    registerHook(`ref:${TYPE}`, { hook: RefHandler, key: manifest.key })
    registerHook('adifFields', { hook: AdifFieldsHook, key: manifest.key })
    registerHook('export', { hook: ExportHook, key: manifest.key })
    registerHook('scoring', {
      hook: contestScorer(ARRLDXScorer, { scope: { refTypes: [TYPE] } }),
      key: manifest.key,
    })
  },
})
