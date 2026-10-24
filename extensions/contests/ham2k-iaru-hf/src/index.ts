// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// IARU HF World Championship. Ported from app-polo's IARUHFExtension.
//
// What it exercises that the other contests don't: a setup form that VARIES
// WITH ITSELF. What we send is
// an ITU zone, a society abbreviation or an IARU office depending on the kind
// of station we are, so the form shows one of three fields — which is the whole
// reason `visibleWhen` exists (docs/design/contests.md §5.4.1).
//
// It needs no reference data. ITU zone and continent both come from the bundled
// country file (§5.3).

import { exportTypeDefinition } from "@ham2k/extension-sdk"
import { qsonToCabrillo } from "@ham2k/lib-qson-cabrillo"
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
import { cabrilloLocation, normalizeSection } from "./location.ts"
import { nextContestDate, relevanceFor } from "./schedule.ts"
import { EXCHANGE_PATTERN, IARUHFScorer, contestTitle, normalizeZone, ourExchange } from "./scorer.ts"
import { OPERATOR_CLASSES, OVERLAY_CLASSES, POWER_CLASSES, cabrilloCategories, declaredClub, declaredOperators } from "./entry.ts"

import manifest from "../manifest.json" with { type: "json" }

/// The ref type an operation stores. It is data in the operator's log, so it
/// stays what the app's own built-in wrote there whatever this package is
/// called: the manifest key names the package, `TYPE` names the activation.
const TYPE = 'iaru-hf'

/// What a search has to contain to offer this contest. Matched as "does the
/// alias contain what was typed", so "iaru" or "championship" finds it.
const ALIASES = ['IARU HF', 'IARU HF WORLD CHAMPIONSHIP', 'HF CHAMPIONSHIP', 'HF WORLD CHAMPIONSHIP']

function refOfType(container: Record<string, JSONValue>, type: string): Record<string, JSONValue> | undefined {
  return (((container.refs as Record<string, JSONValue>[] | undefined) ?? [])).find((r) => r?.type === type)
}

function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

/// The ITU zone the country file resolves for a callsign, as a string. Used
/// both to prefill the exchange field and to stamp it at save.
function guessedZoneFor(their: Record<string, JSONValue>): string {
  const guess = (their.guess as Record<string, JSONValue>) ?? {}
  const call = str(their.call)
  return (
    normalizeZone(their.ituZone) ||
    normalizeZone(guess.ituZone) ||
    (call ? normalizeZone(annotateCallAgainstCountryFile(call).ituZone) : '')
  )
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
    console.warn(`[iaru-hf] profile settings unavailable, keeping the last section read:`, e)
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
    console.warn(`[iaru-hf] profile settings unavailable, exporting without name, email and profile club:`, e)
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
    select('power', POWER_CLASSES),
    select('overlay', OVERLAY_CLASSES),
  ]
}

const ActivityHook = {
  /// Offered in the activity search by NAME and by NEARNESS — one suggestion,
  /// since the mode restriction is an entry category of one contest rather
  /// than a separate running.
  ///
  /// Nothing is offered to an operation that already runs IARU HF: a
  /// suggestion has no `ref` for the picker's duplicate guard to match, so a
  /// tapped one would REPLACE the configured ref and lose its exchange.
  async suggest({ operation, searchTerm }: SuggestArgs, ctx: HookContext): Promise<ActivitySuggestion[]> {
    if (refOfType(operation ?? {}, TYPE)) return []
    const t = tFor(ctx)
    const term = (searchTerm ?? '').trim().toUpperCase()
    if (term && !ALIASES.some((alias) => alias.includes(term))) return []

    const now = Date.now()
    return [
      {
        type: TYPE,
        // A suggestion is persisted VERBATIM and never runs through
        // `decorateRef`, so everything the operation row reads has to be here,
        // and the labels must match what `decorateRef` composes for a Mixed
        // entry.
        program: 'Contest',
        // The same `description • date` line the QSO parties show.
        name: `${t('activityDescription')} • ${nextContestDate(now)}`,
        label: 'IARU HF',
        shortLabel: 'IARU HF',
        relevance: relevanceFor(now),
      },
    ]
  },

  async operationControls(
    _args: { operation: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<LoggingControlDescriptor[]> {
    const t = tFor(ctx)
    return [
      {
        key: 'iaru-hf/setup',
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
                key: 'modeRestriction',
                label: t('modeLabel'),
                // IARU is one weekend with three entry categories, unlike CQ WW's
                // three separate contests — so this restricts what counts rather
                // than naming which contest you're in.
                value: 'Mixed',
                options: [
                  { value: 'Mixed', label: t('modeMixed') },
                  { value: 'CW', label: t('modeCW') },
                  { value: 'Phone', label: t('modePhone') },
                ],
              },
              {
                type: 'field',
                fieldType: 'radio',
                key: 'stationType',
                label: t('stationTypeLabel'),
                // Defaulted, and not merely for convenience: the three fields
                // below key their visibility off this, so leaving it unset would
                // show none of them.
                value: 'normal',
                options: [
                  { value: 'normal', label: t('stationNormal') },
                  { value: 'hq', label: t('stationHQ') },
                  { value: 'official', label: t('stationOfficial') },
                ],
              },
              // Exactly one of the next three shows at a time (§5.4.1). All three
              // keep their values when hidden, so trying HQ and going back to
              // Normal doesn't cost the operator the zone they typed.
              {
                type: 'field',
                fieldType: 'text',
                key: 'zone',
                label: t('ourZoneLabel'),
                placeholder: t('ourZonePlaceholder'),
                visibleWhen: { field: 'stationType', equals: 'normal' },
              },
              {
                type: 'field',
                fieldType: 'text',
                key: 'society',
                label: t('societyLabel'),
                placeholder: t('societyPlaceholder'),
                uppercase: true,
                visibleWhen: { field: 'stationType', equals: 'hq' },
              },
              {
                type: 'field',
                fieldType: 'radio',
                key: 'official',
                label: t('officialLabel'),
                value: 'AC',
                options: [
                  { value: 'AC', label: 'AC' },
                  { value: 'R1', label: 'R1' },
                  { value: 'R2', label: 'R2' },
                  { value: 'R3', label: 'R3' },
                ],
                visibleWhen: { field: 'stationType', equals: 'official' },
              },
              // The entry we are making, for the Cabrillo header, alongside
              // the mode restriction and station type above. Each starts
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
              // Markdown rather than a `link` element: a link renders dead from a
              // setup form, which has no link handler wired to it.
              { type: 'markdown', text: t('rulesLink') },
            ],
          },
        },
      },
    ]
  },

  /// The one field typed per QSO — and it holds three different kinds of value,
  /// so it can't be numeric-only the way CQ WW's zone is. The country file
  /// resolves a zone for most callsigns offline, which covers the common case;
  /// nothing can guess a society, so those are always typed.
  async loggingControls(
    args: { operation: Record<string, JSONValue>; qso?: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<LoggingControlDescriptor[]> {
    // Off-contest, contribute nothing — an optimization, not the rule. The core
    // already refuses a primary field to an activity the operation isn't
    // running; what this saves is a country-file annotation per refresh.
    if (!refOfType(args.operation, TYPE)) return []

    const their = ((args.qso?.their as Record<string, JSONValue>) ?? {})
    const suggested = guessedZoneFor(their)

    return [
      {
        key: 'iaru-hf/exchange',
        label: tFor(ctx)('exchangeLabel'),
        icon: manifest.icon,
        color: manifest.accentColor,
        order: 10,
        input: {
          kind: 'text',
          refType: TYPE,
          field: 'theirExchange',
          maxLength: 10,
          pattern: EXCHANGE_PATTERN,
          // Societies are sent as letters and offices as AC/R1/R2/R3, so this
          // field is uppercase like any other on-air exchange.
          uppercase: true,
          // Only ever the guessed zone for THIS callsign — never a format hint,
          // which reads as a real value at a glance.
          placeholder: suggested || undefined,
          suggestedValue: suggested || undefined,
        },
      },
    ]
  },

  /// Records what was actually received, and mirrors it where the rest of the
  /// app can see it.
  ///
  /// When the operator typed nothing, the country file's ITU zone for that call
  /// is written onto the ref as DATA OF RECORD — not left to be re-derived
  /// later (docs/design/contests.md §8). The scorer falls back to the same
  /// value, so leaving the ref empty is how a log ends up scoring a zone and
  /// exporting a dash. polo's IARU does exactly this.
  ///
  /// `their.exchange` is the projection on top: nothing outside this extension
  /// knows to look inside a contest ref, so without it the QSO row's exchange
  /// column and a plain (non-contest) ADIF export both come up empty.
  async processQsoBeforeSave(
    args: { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> },
    _ctx: HookContext,
  ): Promise<Record<string, JSONValue> | null> {
    if (!refOfType(args.operation, TYPE)) return null

    const qsoRef = refOfType(args.qso, TYPE)
    // PRESENCE of the field, not its truthiness. The core writes
    // `theirExchange: ''` when the operator empties the field on purpose, and
    // drops the key entirely when it was never filled in — so a present key,
    // blank or not, is a decision, and guessing over it would put back what
    // they just removed.
    const decided = qsoRef !== undefined && 'theirExchange' in qsoRef
    // Only a ZONE can be guessed — nothing can infer a society or an office, so
    // those are always the operator's own typing.
    const exchange = decided
      ? str(qsoRef.theirExchange).trim().toUpperCase()
      : guessedZoneFor((args.qso.their as Record<string, JSONValue>) ?? {})

    // A deliberate blank still projects, so clearing an exchange on an edit
    // clears the QSO row's column too instead of leaving the old value there.
    if (!exchange) return decided ? { their: { exchange: '' } } : null

    return {
      // Field-wise into our own ref; the core allows this extension no other.
      refs: [{ type: TYPE, theirExchange: exchange }],
      their: { exchange },
    }
  },
}

const RefHandler = {
  async validateRef({ ref }: { ref: Ref }, _ctx: HookContext) {
    return { valid: true, normalized: (ref.ref ?? '').trim() }
  },

  async decorateRef({ ref }: { ref: Ref }, ctx: HookContext): Promise<Ref> {
    const restriction = str((ref as Record<string, JSONValue>).modeRestriction)
    // "Mixed" is the default and adding it to every label is noise; a
    // restriction is what's worth seeing at a glance.
    const label = ['IARU HF', restriction && restriction !== 'Mixed' ? restriction : undefined]
      .filter(Boolean)
      .join(' ')
    const sent = ourExchange({}, ref as Record<string, JSONValue>)
    return {
      ...ref,
      program: 'Contest',
      label: label || tFor(ctx)('unconfigured'),
      shortLabel: label || tFor(ctx)('unconfigured'),
      name: sent || tFor(ctx)('notConfigured'),
    }
  },

  /// "KI2D for IARU HF" with "Sending 8" beneath it: the sent exchange is the
  /// one thing an operator re-reads constantly, so it goes in the subtitle
  /// rather than being buried in setup.
  async suggestOperationTitle(
    { ref, operation }: { ref: Ref; operation: Record<string, JSONValue> },
    ctx: HookContext,
  ) {
    const sent = ourExchange(operation, ref as Record<string, JSONValue>)
    return {
      for: contestTitle(ref as Record<string, JSONValue>),
      subtitle: sent ? tFor(ctx)('ourExchangeSubtitle', { exchange: sent }) : undefined,
    }
  },

  /// The contest's published rules — a reference here names an event, not a
  /// place, so what there is to read about it is the rules it is run under.
  async linkForRef(_args: { ref: Ref }, _ctx: HookContext): Promise<RefLink | null> {
    return { url: 'https://www.arrl.org/iaru-hf-world-championship', label: 'IARU HF World Championship' }
  },
}

const AdifFieldsHook = {
  async fieldsForOneQSO(
    { qso, operation }: { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> },
    _ctx: HookContext,
  ): Promise<{ name: string; value: string }[]> {
    const opRef = refOfType(operation, TYPE)
    if (!opRef) return []

    // One contest, one identifier — the mode restriction is an entry category,
    // not a different contest, so it never appears here.
    const fields: { name: string; value: string }[] = [{ name: 'CONTEST_ID', value: 'IARU-HF' }]
    const sent = ourExchange(operation, opRef)
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

/// The contest's own name for this operation's file. Unlike CQ WW, nothing on
/// the operation changes it: the mode restriction is an entry category, not a
/// different contest, so every IARU HF log files under the one name.
function contestTag(_operation: Record<string, JSONValue>): string {
  return 'IARU-HF'
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
    const ourCall = str(operation.stationCall)
    const sent = ourExchange(operation, opRef)

    if (args.exportType === `${TYPE}-cabrillo`) {
      const profile = await profileDetails()
      const content = qsonToCabrillo(args.qsos, {
        headers: [
          ['CONTEST', 'IARU-HF'],
          ['CALLSIGN', ourCall],
          // The calls listed at setup — required for a multi-operator entry —
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
          sent || '-',
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

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook('activity', { hook: ActivityHook, key: manifest.key })
    registerHook(`ref:${TYPE}`, { hook: RefHandler, key: manifest.key })
    registerHook('adifFields', { hook: AdifFieldsHook, key: manifest.key })
    registerHook('export', { hook: ExportHook, key: manifest.key })
    registerHook('scoring', {
      hook: contestScorer(IARUHFScorer, { scope: { refTypes: [TYPE] } }),
      key: manifest.key,
    })
  },
})
