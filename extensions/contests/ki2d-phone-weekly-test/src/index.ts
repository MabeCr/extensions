// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Phone Weekly Test, formerly the Phone Fray — new here; app-polo never had
// it. Written from its rules sheet (perluma.com/Phone_Fray_Contest_Rules.pdf):
// "a 30-minute weekday SSB event that is based on NAQP and NS", Wednesdays at
// 0230 UTC, with NAQP's exchange, multipliers and scoring on 160 through 15m,
// "When in doubt, check the NAQP rules".
//
// Like `ham2k-cwt`, a reference names the OCCURRENCE (`{type: 'pwt', ref:
// '2026-10-28'}`): every week is its own entry. And like it, the contest stays
// out of the picker's unprompted list except around a session
// (`sessionAtHand`); searching for it, or scoping the picker to this
// extension, offers the next sessions on any day.
//
// There are no logs to send — "Just post your score on the 3830scores.com
// website within 48 hours" — so there is no Cabrillo export, only the
// contest's ADIF, and the score summary is what gets posted.

import { exportTypeDefinition } from "@ham2k/extension-sdk"
import { rulesNote, withRules } from "@ham2k/lib-contest-rules"
import type { ContestRules } from "@ham2k/lib-contest-rules"
import { stampedExchange } from "@ham2k/lib-contest-exchange"
import { LOCATION_PATTERN, VALID_LOCATIONS, firstName, normalizeLocation, ourExchange } from "@ham2k/lib-naqp-exchange"
import { type WeeklySession, relevanceFor, searchMatches } from "@ham2k/lib-weekly-contest"
import { adifForExport, contestScorer, defineExtension, exportFilename, startMillisOf } from "@ham2k/extension-sdk"
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
import { type Exchange, TYPE, exchangeText, refOfType, str, suggestedExchange } from "./exchange.ts"
import { sessionAtHand, sessionDateLabel, sessionFor, sessionsFrom } from "./schedule.ts"
import { CONTEST_TITLE, PwtScorer } from "./scorer.ts"

import manifest from "../manifest.json" with { type: "json" }

/// The ADIF CONTEST_ID and the files' activity name. The ADIF enumeration has
/// no entry for this contest, and the rules name none.
const CONTEST_ID = 'PWT'

/// The operation row's short label.
const SHORT_TITLE = 'PWT'

/// "Single op, no external amps capable of more than 100 watts output, no
/// assistance" — and, from the NAQP rules it defers to, no self-spotting.
const CONTEST_RULES: ContestRules = { assistance: false, selfSpotting: false }

/// How many sessions a search or a scoped picker offers.
const SESSIONS_OFFERED = 4

/// The words a search for it can be made of — "phone weekly", "phone fray",
/// "pwt". See `searchMatches`.
const SEARCH_WORDS = ['PHONE', 'WEEKLY', 'FRAY', 'PWT', 'SSB']

function sessionOn(operation: Record<string, JSONValue> | undefined): WeeklySession | undefined {
  return sessionFor(str(refOfType(operation, TYPE)?.ref))
}

/// The operation row's second line: the session, and what we send — or that
/// the setup still lacks our name, or holds a location that is none. The
/// location may rightly be blank, from outside North America.
function rowName(session: WeeklySession | undefined, ours: Exchange, t: ReturnType<typeof tFor>): string {
  const sending = !ours.name
    ? t('notConfigured')
    : ours.location && !VALID_LOCATIONS.has(ours.location)
      ? t('notALocation', { location: ours.location })
      : exchangeText(ours)
  return [session ? sessionDateLabel(session) : t('noSession'), sending].join(' · ')
}

/// One picker row for a session. A suggestion is persisted VERBATIM and never
/// runs through `decorateRef`, so everything the operation row reads has to be
/// here, the rules flags included — and the row says "Not configured!" until
/// the setup is saved, as a decorated one would.
function suggestionFor(session: WeeklySession, nowMillis: number, ctx: HookContext): ActivitySuggestion {
  return withRules({
    type: TYPE,
    ref: session.key,
    name: rowName(session, ourExchange(undefined), tFor(ctx)),
    program: 'Contest',
    label: CONTEST_TITLE,
    shortLabel: SHORT_TITLE,
    relevance: relevanceFor(session, nowMillis),
  }, CONTEST_RULES) as ActivitySuggestion
}

const ActivityHook = {
  /// Offered by name, or by being near — see the file header. Nothing is
  /// offered to an operation that already runs the contest: a tapped
  /// suggestion would REPLACE the configured ref and lose its setup, and the
  /// setup form is where its session is changed.
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
      // `ourName`/`ourLocation`, not `name`/`location`: a form field key IS a
      // key on the ref, and `name` is the slot `decorateRef` writes the
      // activity row's subtitle into.
      { type: 'field', fieldType: 'text', key: 'ourName', label: t('ourNameLabel'), placeholder: t('ourNamePlaceholder'), uppercase: true },
      { type: 'field', fieldType: 'text', key: 'ourLocation', label: t('ourLocationLabel'), placeholder: t('ourLocationPlaceholder'), uppercase: true },
      rulesNote(ctx, CONTEST_RULES),
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

  /// Their name and location, both suggested — see `suggestedExchange`. The
  /// signal report is not part of the exchange.
  async loggingControls(
    { operation, qso }: { operation: Record<string, JSONValue>; qso?: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<LoggingControlDescriptor[]> {
    if (!refOfType(operation, TYPE)) return []

    const t = tFor(ctx)
    const their = (qso?.their as Record<string, JSONValue>) ?? {}
    const { name, location } = await suggestedExchange(ctx, operation, their)

    return [
      {
        key: `${TYPE}/name`,
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
        key: `${TYPE}/location`,
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

  /// Records what was received, and mirrors both exchanges where the rest of
  /// the app can see them. A contact logged without the fields showing — a
  /// call list, a call stack — gets what they would have suggested.
  async processQsoBeforeSave(
    { qso, operation }: { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<Record<string, JSONValue> | null> {
    const opRef = refOfType(operation, TYPE)
    if (!opRef) return null

    const qsoRef = refOfType(qso, TYPE)
    const decided = (key: string) => qsoRef !== undefined && key in qsoRef
    const guess = decided('name') && decided('location')
      ? { name: '', location: '' }
      : await suggestedExchange(ctx, operation, (qso.their as Record<string, JSONValue>) ?? {})
    const received = stampedExchange(TYPE, qsoRef, {
      name: { read: firstName, guess: () => guess.name },
      location: { read: normalizeLocation, guess: () => guess.location },
    }, exchangeText)

    const ours = exchangeText(ourExchange(opRef))
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
    const ours = ourExchange(ref as Record<string, JSONValue>)
    const decorated = {
      ...ref,
      ...(session ? { ref: session.key } : {}),
      program: 'Contest',
      label: CONTEST_TITLE,
      shortLabel: SHORT_TITLE,
      name: rowName(session, ours, t),
    }
    return withRules(decorated, CONTEST_RULES)
  },

  /// "KI2D for Phone Weekly Test" with "Sending SEB NY" beneath it.
  async suggestOperationTitle(
    { ref }: { ref: Ref; operation: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<TitleSuggestion | null> {
    const ours = ourExchange(ref as Record<string, JSONValue>)
    return { for: CONTEST_TITLE, subtitle: ours.name ? tFor(ctx)('ourExchangeSubtitle', { exchange: exchangeText(ours) }) : undefined }
  },

  async linkForRef(_args: { ref: Ref }, _ctx: HookContext): Promise<RefLink | null> {
    return { url: 'http://www.perluma.com/Phone_Fray_Contest_Rules.pdf', label: CONTEST_TITLE }
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
    const qsoRef = refOfType(qso, TYPE)
    add('STX_STRING', exchangeText(ourExchange(opRef)))
    add('SRX_STRING', exchangeText({ name: firstName(qsoRef?.name), location: normalizeLocation(qsoRef?.location) }))
    return fields
  },
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
    return [exportTypeDefinition(TYPE, 'adif', manifest.shortName)]
  },

  async suggestExportOptions(args: ExportOptionsRequest, ctx: HookContext): Promise<ExportOption[]> {
    if (!refOfType(args.operation, TYPE)) return []
    return [
      {
        exportType: `${TYPE}-adif`,
        templateData: { activity: filenameActivity(args.operation) },
        format: 'adif',
        label: tFor(ctx)('adifExport', { contest: manifest.shortName }),
        filename: filenameFor(args.operation, args.qsos ?? [], 'adi', args.compactFilenames),
        selectedByDefault: true,
        refType: TYPE,
      },
    ]
  },

  async generateExport(args: ExportRequest, _ctx: HookContext): Promise<ExportResult> {
    // Only the exportType offered above. A hook answering for an exportType it
    // never offered makes the ADIF delegation recurse into itself.
    if (args.exportType !== `${TYPE}-adif`) return { filename: '', mimeType: '', content: '' }

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
    return { filename: filenameFor(args.operation, args.qsos, 'adi', args.compactFilenames), mimeType: 'text/plain', content }
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
      hook: contestScorer(PwtScorer, { scope: { refTypes: [TYPE] } }),
      key: manifest.key,
    })
  },
})
