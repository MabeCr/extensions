// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Worldwide Sideband Activity Contest — new here; app-polo never had it.
// Written from the sponsor's rules (wwsac.com/rules.html) and its N1MM
// user-defined contest file (wwsac.com/WWSACv3.udc), which is where the
// Cabrillo name, the column order and the dupe rule come from.
//
// An hour of SSB every week, Tuesdays at 0100 UTC. The exchange is a signal
// report and an age group — OM, YL, Y (Youth) or YYL (Youth YL) — and the
// other station's age group is what the contact is worth. Every callsign
// prefix is a multiplier, as in CQ WPX.
//
// Like `ham2k-cwt`, a reference names the OCCURRENCE (`{type: 'wwsac', ref:
// '2026-10-27'}`): every week is its own entry, submitted within 24 hours of
// its end. And like it, the contest stays out of the picker's unprompted list
// except around a session (`sessionAtHand`); searching for it, or scoping the
// picker to this extension, offers the next sessions on any day.

import { exportTypeDefinition } from "@ham2k/extension-sdk"
import { qsonToCabrillo } from "@ham2k/lib-qson-cabrillo"
import { rulesNote, withRules } from "@ham2k/lib-contest-rules"
import { stampedExchange } from "@ham2k/lib-contest-exchange"
import { type WeeklySession, relevanceFor, searchMatches } from "@ham2k/lib-weekly-contest"
import { adifForExport, contestScorer, defineExtension, exportFilename, host, startMillisOf } from "@ham2k/extension-sdk"
import type {
  ActivitySuggestion,
  ExportOption,
  ExportOptionsRequest,
  ExportRequest,
  ExportResult,
  FormElement,
  HookContext,
  JSONValue,
  LoggingControlDescriptor,
  Ref,
  RefLink,
  SuggestArgs,
  TitleSuggestion,
} from "@ham2k/extension-sdk"

import { tFor } from "./i18n.ts"
import { CONTEST_RULES, POWER_CLASSES, cabrilloCategories } from "./entry.ts"
import { AGE_GROUPS, AGE_GROUP_PATTERN, TYPE, ourAgeGroup, priorAgeGroup, refOfType, str, theirAgeGroup } from "./exchange.ts"
import { sessionAtHand, sessionDateLabel, sessionFor, sessionsFrom } from "./schedule.ts"
import { CONTEST_TITLE, WwsacScorer } from "./scorer.ts"

import manifest from "../manifest.json" with { type: "json" }

/// The Cabrillo CONTEST line — the sponsor's N1MM file's `CabrilloName` — and
/// the ADIF CONTEST_ID, which the ADIF enumeration does not list.
const CONTEST_ID = 'WWSAC'

/// How many sessions a search or a scoped picker offers.
const SESSIONS_OFFERED = 4

/// The words a search for it can be made of — "wwsac", "sideband activity",
/// "world wide sideband". See `searchMatches`.
const SEARCH_WORDS = ['WWSAC', 'WORLDWIDE', 'WORLD', 'WIDE', 'SIDEBAND', 'ACTIVITY', 'SSB']

function sessionOn(operation: Record<string, JSONValue> | undefined): WeeklySession | undefined {
  return sessionFor(str(refOfType(operation, TYPE)?.ref))
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

/// The operation row's second line: the session, and our age group — or that
/// the setup still lacks it, and every sent exchange would export blank.
function rowName(session: WeeklySession | undefined, ours: string, t: ReturnType<typeof tFor>): string {
  return [session ? sessionDateLabel(session) : t('noSession'), ours ? t(`ourAgeGroup_${ours}`) : t('notConfigured')].join(' · ')
}

/// One picker row for a session. A suggestion is persisted VERBATIM and never
/// runs through `decorateRef`, so everything the operation row reads has to be
/// here, the rules flags included — and the row says "Not configured!" until
/// the setup is saved, as a decorated one would.
function suggestionFor(session: WeeklySession, nowMillis: number, ctx: HookContext): ActivitySuggestion {
  return withRules({
    type: TYPE,
    ref: session.key,
    name: rowName(session, '', tFor(ctx)),
    program: 'Contest',
    label: CONTEST_TITLE,
    shortLabel: CONTEST_TITLE,
    relevance: relevanceFor(session, nowMillis),
  }, CONTEST_RULES) as ActivitySuggestion
}

const ActivityHook = {
  /// Offered by name, or by being near — see the file header. Nothing is
  /// offered to an operation that already runs the WWSAC: a tapped suggestion
  /// would REPLACE the configured ref and lose its setup, and the setup form
  /// is where its session is changed.
  async suggest({ operation, searchTerm, scoped }: SuggestArgs, ctx: HookContext): Promise<ActivitySuggestion[]> {
    if (refOfType(operation, TYPE)) return []
    const term = (searchTerm ?? '').trim().toUpperCase()
    const namesThisContest = !term || searchMatches(term, SEARCH_WORDS)
    if (!namesThisContest && !scoped) return []

    const now = Date.now()
    if (term || scoped) {
      const sessions = sessionsFrom(now, SESSIONS_OFFERED)
      // Within a scope, a date narrows the list rather than emptying it.
      const matching = namesThisContest ? sessions : sessions.filter((session) => session.key.includes(term))
      return matching.map((session) => suggestionFor(session, now, ctx))
    }

    const session = sessionAtHand(now)
    return session ? [suggestionFor(session, now, ctx)] : []
  },

  async operationControls(
    { operation }: { operation: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<LoggingControlDescriptor[]> {
    const t = tFor(ctx)
    const currentKey = str(refOfType(operation, TYPE)?.ref)
    const options = sessionsFrom(Date.now(), SESSIONS_OFFERED)
      .map((session) => ({ value: session.key, label: sessionDateLabel(session) }))
    // An operation opened weeks later names a session that has long since
    // dropped off the list; its own reference still has to be selectable, or
    // saving the form would silently move the log to another week.
    if (currentKey && !options.some((option) => option.value === currentKey)) {
      const known = sessionFor(currentKey)
      options.unshift({ value: currentKey, label: known ? sessionDateLabel(known) : currentKey })
    }
    const select = (key: string, values: readonly string[]) => ({
      type: 'field' as const,
      fieldType: 'select' as const,
      key,
      label: t(`${key}Label`),
      value: '',
      options: [{ value: '', label: t('notDeclared') }, ...values.map((value) => ({ value, label: t(`${key}_${value}`) }))],
    })

    const elements: FormElement[] = [
      {
        type: 'field',
        fieldType: 'select',
        // The session IS the ref's identity, so this writes `ref` — the one
        // core-owned key a setup form legitimately sets.
        key: 'ref',
        label: t('sessionLabel'),
        value: currentKey || options[0]?.value,
        options,
      },
      // The age group we send, which is also our overlay (5). Not defaulted:
      // it is a claim about the operator, and a YL logged as OM loses her
      // overlay. `decorateRef` says so until it is answered.
      select('ourAgeGroup', AGE_GROUPS),
      rulesNote(ctx, CONTEST_RULES),
      select('power', POWER_CLASSES),
      { type: 'markdown', text: t('rulesLink') },
    ]

    return [
      {
        key: `${TYPE}/setup`,
        label: t('activityLabel'),
        icon: manifest.icon,
        color: manifest.accentColor,
        order: 10,
        input: { kind: 'form', refType: TYPE, form: { title: t('setupLabel'), elements } },
      },
    ]
  },

  /// Their age group. The report is the core's own RST field.
  ///
  /// Suggested from what this station sent in an earlier contact; otherwise
  /// only HINTED as OM. Most stations are, but a guess is committed as the
  /// exchange received, and a YL scored as an OM is four points gone without
  /// a word — so an unconfirmed one stays blank and the scorer flags it.
  async loggingControls(
    { operation, qso }: { operation: Record<string, JSONValue>; qso?: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<LoggingControlDescriptor[]> {
    if (!refOfType(operation, TYPE)) return []

    const t = tFor(ctx)
    const call = str(((qso?.their as Record<string, JSONValue>) ?? {}).call).toUpperCase()
    const prior = await priorAgeGroup(ctx, call)

    return [
      {
        key: `${TYPE}/ageGroup`,
        label: t('ageGroupLabel'),
        icon: manifest.icon,
        color: manifest.accentColor,
        order: 10,
        input: {
          kind: 'text',
          refType: TYPE,
          field: 'ageGroup',
          maxLength: 3,
          uppercase: true,
          pattern: AGE_GROUP_PATTERN,
          placeholder: prior || 'OM',
          suggestedValue: prior || undefined,
        },
      },
    ]
  },

  /// Records what was received, and mirrors both halves where the rest of the
  /// app can see them: our age group into `our.exchange`, theirs into
  /// `their.exchange`.
  async processQsoBeforeSave(
    { qso, operation }: { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<Record<string, JSONValue> | null> {
    const opRef = refOfType(operation, TYPE)
    if (!opRef) return null

    const qsoRef = refOfType(qso, TYPE)
    // A contact logged without the field showing — a call list, a call stack —
    // gets the age group the entry field would have suggested.
    const prior = qsoRef !== undefined && 'ageGroup' in qsoRef
      ? ''
      : await priorAgeGroup(ctx, str(((qso.their as Record<string, JSONValue>) ?? {}).call).toUpperCase())
    const received = stampedExchange(TYPE, qsoRef, {
      // "YOUTH" becomes "Y"; anything unrecognized is kept as typed, for the
      // scorer to flag rather than for this hook to lose.
      ageGroup: { read: theirAgeGroup, guess: () => prior },
    }, ({ ageGroup }) => ageGroup)

    const ours = ourAgeGroup(opRef)
    if (!ours) return received
    return { ...received, our: { exchange: ours } }
  },
}

const RefHandler = {
  async validateRef({ ref }: { ref: Ref }, _ctx: HookContext) {
    const normalized = (ref.ref ?? '').trim()
    return { valid: sessionFor(normalized) !== undefined, normalized }
  },

  async decorateRef({ ref }: { ref: Ref }, ctx: HookContext): Promise<Ref> {
    const t = tFor(ctx)
    const session = sessionFor(ref.ref)
    const ours = ourAgeGroup(ref as Record<string, JSONValue>)
    const decorated = {
      ...ref,
      ...(session ? { ref: session.key } : {}),
      program: 'Contest',
      label: CONTEST_TITLE,
      shortLabel: CONTEST_TITLE,
      name: rowName(session, ours, t),
    }
    return withRules(decorated, CONTEST_RULES)
  },

  /// "KI2D for WWSAC" with "Sending OM" beneath it.
  async suggestOperationTitle(
    { ref }: { ref: Ref; operation: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<TitleSuggestion | null> {
    const ours = ourAgeGroup(ref as Record<string, JSONValue>)
    return { for: CONTEST_TITLE, subtitle: ours ? tFor(ctx)('ourExchangeSubtitle', { ageGroup: ours }) : undefined }
  },

  async linkForRef(_args: { ref: Ref }, _ctx: HookContext): Promise<RefLink | null> {
    return { url: 'https://wwsac.com/rules.html', label: 'WWSAC' }
  },
}

const AdifFieldsHook = {
  async fieldsForOneQSO(
    { qso, operation }: { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> },
    _ctx: HookContext,
  ): Promise<{ name: string; value: string }[]> {
    const opRef = refOfType(operation, TYPE)
    if (!opRef) return []

    const fields: { name: string; value: string }[] = [{ name: 'CONTEST_ID', value: CONTEST_ID }]
    const add = (name: string, value: string) => {
      if (value) fields.push({ name, value })
    }
    add('STX_STRING', ourAgeGroup(opRef))
    add('SRX_STRING', theirAgeGroup(refOfType(qso, TYPE)?.ageGroup))
    return fields
  },
}

/// A signal report as logged, else the 59 nearly every contact gets.
function reportFor(qso: Record<string, JSONValue>, side: 'our' | 'their'): string {
  return str(((qso[side] as Record<string, JSONValue>) ?? {}).sent).trim() || '59'
}

/// This operation's own name for its files — the session, since every week is
/// a separate entry and their files must not collide.
function filenameActivity(operation: Record<string, JSONValue>): string {
  const session = sessionOn(operation)
  return session ? `${CONTEST_ID}-${session.key}` : CONTEST_ID
}

function filenameFor(operation: Record<string, JSONValue>, qsos: Record<string, JSONValue>[], extension: string, compact?: boolean): string {
  return exportFilename({
    stationCall: operation.stationCall,
    activity: filenameActivity(operation),
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
        templateData: { activity: filenameActivity(args.operation) },
        format: 'adif',
        label: t('adifExport', { contest: manifest.shortName }),
        filename: named('adi'),
        selectedByDefault: true,
        refType: TYPE,
      },
      {
        exportType: `${TYPE}-cabrillo`,
        templateData: { activity: filenameActivity(args.operation) },
        format: 'cabrillo',
        label: t('cabrilloExport', { contest: manifest.shortName }),
        filename: named('log'),
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

    if (args.exportType === `${TYPE}-cabrillo`) {
      const profile = await profileDetails()
      const ours = ourAgeGroup(opRef)
      const content = qsonToCabrillo(args.qsos, {
        headers: [
          ['CALLSIGN', ourCall],
          ['CONTEST', CONTEST_ID],
          ...cabrilloCategories(opRef),
          ['NAME', profile.name],
          ['EMAIL', profile.email],
          // Single operator only: the one at the microphone.
          ['OPERATORS', str((operation.local as Record<string, JSONValue>)?.operatorCall) || ourCall],
          ['GRID-LOCATOR', str(operation.grid)],
        ],
        // After freq, mode, date and time, the N1MM file's columns: call,
        // report and age group sent, then received —
        // `QSO: 14225 PH 2026-10-27 0102 KI2D 59 OM K1ABC 57 YL`.
        qsoParts: (qso) => [
          ourCall || '-',
          reportFor(qso, 'our'),
          ours || '-',
          str(((qso.their as Record<string, JSONValue>) ?? {}).call) || '-',
          reportFor(qso, 'their'),
          theirAgeGroup(refOfType(qso, TYPE)?.ageGroup) || '-',
        ],
      })
      return { filename: filenameFor(operation, args.qsos, 'log', args.compactFilenames), mimeType: 'text/plain', content }
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
    return { filename: filenameFor(operation, args.qsos, 'adi', args.compactFilenames), mimeType: 'text/plain', content }
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
      hook: contestScorer(WwsacScorer, { scope: { refTypes: [TYPE] } }),
      key: manifest.key,
    })
  },
})
