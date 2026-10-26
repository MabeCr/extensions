// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// CQ World Wide DX Contest. Ported from app-polo's CQWWExtension.
//
// What it exercises that simple-contest doesn't: a validated numeric
// exchange, and per-band
// multipliers accumulated from two different axes (zone and country).

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
import { MODES, nearestMode, nextContestDate, relevanceFor } from "./schedule.ts"
import { CQWWScorer, ZONE_PATTERN, contestTitle, cqwwCallInfo, normalizeZone } from "./scorer.ts"
import { QTH_PATTERN, cabrilloLocation, guessedQth, normalizeQth, sendsQth } from "./qth.ts"
import { BAND_CLASSES, OPERATOR_CLASSES, OVERLAY_CLASSES, POWER_CLASSES, cabrilloCategories, contestRules, declaredClub, declaredOperators } from "./entry.ts"

import manifest from "../manifest.json" with { type: "json" }

/// The ref type an operation stores. It is data in the operator's log, so it
/// stays what the app's own built-in wrote there whatever this package is
/// called: the manifest key names the package, `TYPE` names the activation.
const TYPE = 'cqww'

/// What a search has to contain to offer these contests. Matched as "does the
/// alias contain what was typed", so "cq" finds them and the date ranking
/// decides which running comes first.
const ALIASES = ['CQWW', 'CQ WW', 'CQ WORLD WIDE', 'WORLD WIDE DX', 'WWDX']

function refOfType(container: Record<string, JSONValue>, type: string): Record<string, JSONValue> | undefined {
  return (((container.refs as Record<string, JSONValue>[] | undefined) ?? [])).find((r) => r?.type === type)
}

function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

/// Our own zone: whatever was set at setup, else the country file's answer for
/// our station call — right for the great majority of operators, and better
/// than exporting an empty exchange.
function ourZone(operation: Record<string, JSONValue>): string {
  const configured = normalizeZone(refOfType(operation, TYPE)?.zone)
  if (configured) return configured
  return normalizeZone(cqwwCallInfo(str(operation.stationCall)).cqZone)
}

/// Our QTH as part of the exchange — sent on the RTTY weekend only, by a
/// continental W/VE station: whatever was set at setup, else the call area our
/// own call names (for Canada; a US state can't be told from the call).
function ourQth(operation: Record<string, JSONValue>): string {
  const ref = refOfType(operation, TYPE)
  const call = str(operation.stationCall)
  if (str(ref?.mode) !== 'RTTY' || !call || !sendsQth(call)) return ''
  return normalizeQth(ref?.qth) || guessedQth({ call })
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
    console.warn(`[cqww] profile settings unavailable, exporting without name, email and profile club:`, e)
    return { name: '', email: '', club: '' }
  }
}

/// The zone, and on RTTY the QTH, as one exchange — `05 MA` — the way it is
/// sent, shown and exported.
function exchangeOf(zone: string, qth: string): string {
  return [zone, qth].filter((part) => part).join(' ')
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
  /// runnings, each ranked by its own weekend, so in October SSB leads and in
  /// November CW.
  ///
  /// Nothing is offered to an operation that already runs CQ WW. The mode
  /// lives on the ref as `mode`, not `ref`, and the picker's duplicate guard
  /// only fires for a suggestion with a `ref` — so a tapped suggestion would
  /// REPLACE the configured ref, silently losing its zone. Changing the mode
  /// goes through the existing setup instead.
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
      // The date is what tells the three runnings apart at a glance — the
      // same `description • date` line the QSO parties show.
      name: `${t('activityDescription')} • ${nextContestDate(now, mode)}`,
      label: `CQ WW ${mode}`,
      shortLabel: `CQ WW ${mode}`,
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
        key: 'cqww/setup',
        // Named for the contest family — this is what the Activity Types list
        // shows, where "Setup" would read as a settings screen rather than the
        // thing you're adding to the operation.
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
                // CQ WW runs these as separate contests on separate weekends.
                options: [{ value: 'CW', label: 'CW' }, { value: 'SSB', label: 'SSB' }, { value: 'RTTY', label: 'RTTY' }],
              },
              {
                type: 'field',
                fieldType: 'text',
                key: 'zone',
                label: t('ourZoneLabel'),
                placeholder: t('ourZonePlaceholder'),
              },
              {
                type: 'field',
                fieldType: 'text',
                key: 'qth',
                label: t('ourQthLabel'),
                placeholder: t('ourQthPlaceholder'),
                uppercase: true,
                // Sent in the RTTY exchange, and the Cabrillo LOCATION line
                // every weekend asks a US or Canadian station for.
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

  /// The one field typed per QSO. The country file resolves a zone for most
  /// callsigns offline, so it's offered as a suggestion the operator can
  /// correct — a station may be operating away from its callsign's zone.
  async loggingControls(
    args: { operation: Record<string, JSONValue>; qso?: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<LoggingControlDescriptor[]> {
    // Off-contest, contribute nothing. This is an OPTIMIZATION, not the rule:
    // the core already refuses a primary field to any activity the operation
    // isn't running (halo_widgets' `_textControls`), so forgetting this guard
    // is invisible to the operator. What it saves is the work below — a country
    // -file annotation per keystroke-triggered refresh, in the JS isolate,
    // multiplied by every contest extension the user happens to have enabled.
    if (!refOfType(args.operation, TYPE)) return []

    const their = ((args.qso?.their as Record<string, JSONValue>) ?? {})
    const guess = (their.guess as Record<string, JSONValue>) ?? {}
    const call = str(their.call)
    const suggested =
      normalizeZone(guess.cqZone) || (call ? normalizeZone(cqwwCallInfo(call).cqZone) : '')
    const rtty = str(refOfType(args.operation, TYPE)?.mode) === 'RTTY'
    const suggestedQth = rtty ? guessedQth(their) : ''

    return [
      {
        key: 'cqww/zone',
        label: tFor(ctx)('zoneLabel'),
        icon: manifest.icon,
        color: manifest.accentColor,
        order: 10,
        input: {
          kind: 'text',
          refType: TYPE,
          field: 'theirZone',
          numeric: true,
          maxLength: 3,
          pattern: ZONE_PATTERN,
          // Only ever the guessed zone for THIS callsign — never a format
          // hint like "1-40", which reads as a real value at a glance.
          placeholder: suggested || undefined,
          // Filled in for the operator, but never over something they typed.
          suggestedValue: suggested || undefined,
        },
      },
      // RTTY's second field: the state or call area a W/VE station sends. A
      // DX station sends none, so it is simply left empty for them.
      ...(rtty
        ? [{
            key: 'cqww/qth',
            label: tFor(ctx)('qthLabel'),
            icon: manifest.icon,
            color: manifest.accentColor,
            order: 20,
            input: {
              kind: 'text' as const,
              refType: TYPE,
              field: 'theirQth',
              maxLength: 3,
              uppercase: true,
              pattern: QTH_PATTERN,
              placeholder: suggestedQth || undefined,
              suggestedValue: suggestedQth || undefined,
            },
          }]
        : []),
    ]
  },

  /// Records the zone they sent, and mirrors it where the rest of the app can
  /// see it.
  ///
  /// When the operator typed nothing, the country file's zone for that call is
  /// written onto the ref as DATA OF RECORD (docs/design/contests.md §8). The
  /// scorer already falls back to the same value, so without this a QSO could
  /// earn a zone multiplier and then export a dash — the log disagreeing with
  /// its own score. The logging control's `suggestedValue` fills this in
  /// whenever a lookup resolves; this covers the QSOs where none did.
  ///
  /// `their.exchange` is the projection on top: nothing outside this extension
  /// knows to look inside a contest ref, so without it the QSO row's exchange
  /// column and a plain (non-contest) ADIF export both come up empty.
  async processQsoBeforeSave(
    args: { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> },
    _ctx: HookContext,
  ): Promise<Record<string, JSONValue> | null> {
    if (!refOfType(args.operation, TYPE)) return null

    const their = ((args.qso.their as Record<string, JSONValue>) ?? {})
    const guess = (their.guess as Record<string, JSONValue>) ?? {}
    const call = str(their.call)
    const qsoRef = refOfType(args.qso, TYPE)

    // PRESENCE of the field, not its truthiness. The core writes `theirZone: ''`
    // when the operator empties the field on purpose, and drops the key
    // entirely when it was simply never filled in — so a present key, blank or
    // not, is a decision, and guessing over it would put back what they just
    // removed.
    const zone = qsoRef && 'theirZone' in qsoRef
      ? normalizeZone(qsoRef.theirZone)
      : normalizeZone(guess.cqZone) || (call ? normalizeZone(cqwwCallInfo(call).cqZone) : '')
    // RTTY's QTH, by the same presence rule, and only from a W/VE station.
    const rtty = str(refOfType(args.operation, TYPE)?.mode) === 'RTTY'
    const qth = !rtty || !call || !sendsQth(call)
      ? ''
      : qsoRef && 'theirQth' in qsoRef ? normalizeQth(qsoRef.theirQth) : guessedQth(their)
    const exchange = exchangeOf(zone, qth)
    const decided = Boolean(qsoRef && ('theirZone' in qsoRef || 'theirQth' in qsoRef))

    // A deliberate blank still projects, so clearing an exchange on an edit
    // clears the QSO row's column too instead of leaving the old value there.
    if (!exchange) {
      return decided ? { their: { exchange: '' } } : null
    }

    return {
      // Field-wise into our own ref; the core allows this extension no other.
      refs: [{ type: TYPE, ...(zone ? { theirZone: zone } : {}), ...(qth ? { theirQth: qth } : {}) }],
      their: { exchange },
    }
  },
}

const RefHandler = {
  async validateRef({ ref }: { ref: Ref }, _ctx: HookContext) {
    return { valid: true, normalized: (ref.ref ?? '').trim() }
  },

  async decorateRef({ ref }: { ref: Ref }, ctx: HookContext): Promise<Ref> {
    const mode = str((ref as Record<string, JSONValue>).mode)
    const label = mode ? `CQ WW ${mode}` : tFor(ctx)('unconfigured')
    const zone = exchangeOf(
      normalizeZone((ref as Record<string, JSONValue>).zone),
      mode === 'RTTY' ? normalizeQth((ref as Record<string, JSONValue>).qth) : '',
    )
    const t = tFor(ctx)
    // `ourZoneSubtitle`, not a hardcoded `Zone ${zone}`: the two halves of
    // this line have to speak the same language, and the key already exists
    // for `suggestOperationTitle`.
    const decorated = { ...ref, program: 'Contest', label, shortLabel: label, name: zone ? t('ourZoneSubtitle', { zone }) : t('notConfigured') }
    return withRules(decorated, contestRules((ref as Record<string, JSONValue>).operator))
  },

  /// "KI2D for CQWW CW" with "Zone 8" beneath it: the sent exchange is the one
  /// thing an operator re-reads constantly during a contest, so it goes in the
  /// subtitle rather than being buried in setup.
  async suggestOperationTitle(
    { ref, operation }: { ref: Ref; operation: Record<string, JSONValue> },
    ctx: HookContext,
  ) {
    const zone = exchangeOf(ourZone(operation), ourQth(operation))
    return {
      for: contestTitle(ref as Record<string, JSONValue>),
      subtitle: zone ? tFor(ctx)('ourZoneSubtitle', { zone }) : undefined,
    }
  },

  /// The contest's published rules — a reference here names an event, not a
  /// place, so what there is to read about it is the rules it is run under.
  async linkForRef(_args: { ref: Ref }, _ctx: HookContext): Promise<RefLink | null> {
    return { url: 'https://www.cqww.com/rules.htm', label: 'CQ WW' }
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
      { name: 'CONTEST_ID', value: mode ? `CQ-WW-${mode}` : 'CQ-WW' },
    ]
    const sent = exchangeOf(ourZone(operation), ourQth(operation))
    const qsoRef = refOfType(qso, TYPE)
    const received = exchangeOf(normalizeZone(qsoRef?.theirZone), mode === 'RTTY' ? normalizeQth(qsoRef?.theirQth) : '')
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

/// The contest's own name for this operation's file — the mode is part of
/// the identity here, since CQ WW CW and CQ WW SSB are separate contests
/// with separate submissions.
function contestTag(operation: Record<string, JSONValue>): string {
  const mode = str(refOfType(operation, TYPE)?.mode)
  return `CQ-WW-${mode || 'DX'}`
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
    const sentZone = ourZone(operation)
    // The RTTY log carries a QTH column on both sides: `DX` for a station
    // that sends none, and a dash for a W/VE one whose QTH is missing — `DX`
    // there would claim the station sent none.
    const rtty = mode === 'RTTY'
    const qthColumn = (call: string, qth: string) => (call && sendsQth(call) ? qth || '-' : 'DX')
    const sentQth = qthColumn(ourCall, ourQth(operation))

    if (args.exportType === `${TYPE}-cabrillo`) {
      const profile = await profileDetails()
      const content = qsonToCabrillo(args.qsos, {
        headers: [
          ['CONTEST', mode ? `CQ-WW-${mode}` : 'CQ-WW'],
          ['CALLSIGN', ourCall],
          // The calls listed at setup — required for a multi-operator entry —
          // else the app's own operator call.
          ['OPERATORS', declaredOperators(refOfType(operation, TYPE)) || str((operation.local as Record<string, JSONValue>)?.operatorCall)],
          ['LOCATION', cabrilloLocation(ourCall, refOfType(operation, TYPE)?.qth)],
          ...cabrilloCategories(refOfType(operation, TYPE)),
          ['GRID-LOCATOR', str(operation.grid)],
          // The club typed at setup, else the profile's.
          ['CLUB', declaredClub(refOfType(operation, TYPE)) || profile.club],
          ['NAME', profile.name],
          ['EMAIL', profile.email],
        ],
        qsoParts: (qso) => [
          ourCall || '-',
          reportFor(qso, 'our'),
          sentZone || '-',
          ...(rtty ? [sentQth] : []),
          str(((qso.their as Record<string, JSONValue>) ?? {}).call) || '-',
          reportFor(qso, 'their'),
          normalizeZone(refOfType(qso, TYPE)?.theirZone) || '-',
          ...(rtty
            ? [qthColumn(str(((qso.their as Record<string, JSONValue>) ?? {}).call), normalizeQth(refOfType(qso, TYPE)?.theirQth))]
            : []),
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
      hook: contestScorer(CQWWScorer, { scope: { refTypes: [TYPE] } }),
      key: manifest.key,
    })
  },
})
