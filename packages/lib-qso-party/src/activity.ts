// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// How a party is found, set up and typed into.
//
// One extension is ONE party, so nothing here asks which one: the party the
// operator chose is the extension they enabled, and what the setup form asks for
// is where they are operating from and what they are claiming.
//
// **What a rover does, and why nothing here implements it.** A county changes
// mid-log through SEGMENTS: the operator types BREAK and edits the location in
// setup, `refs` is one of the keys a segment restates, and the scorer is handed
// the segment-effective ref for every QSO. "Rolling location scoring" is a
// property of where the county is READ from, not a mechanism this module owns.

import type {
  ActivityHook,
  ActivitySuggestion,
  FormElement,
  HookContext,
  JSONValue,
  LoggingControlDescriptor,
  SuggestArgs,
} from "@ham2k/extension-sdk"

import {
  ROVING_STATION_CLASSES,
  ourEmail,
  ourLocationText,
  ourModeClass,
  ourName,
  ourOperatorClass,
  ourOverlayClass,
  ourPowerClass,
  ourStationClass,
  partyRefIn,
  serial as serialOf,
  str,
} from "./entry.ts"
import {
  exchangeInheritPrefix,
  exchangeOptionsFor,
  exchangeTransforms,
  loggedExchangeFor,
  pastExchangeHolds,
  preferredCodesFor,
} from "./exchange.ts"
import { entityPrefixForCall } from "./dxcc.ts"
import { COUNTY_LINE_SEPARATOR, defaultTheirLocation, guessedStateOf, stateForEntity } from "./location.ts"
import type {
  ModeClass,
  OperatorClass,
  OverlayClass,
  PowerClass,
  QsoPartyLabel,
  QsoPartyParams,
  StationClass,
} from "./params.ts"
import { daysUntil, hasAlreadyRun, type Party, partyStates, resolveLabel, resolveParty } from "./party.ts"

/// This station's contacts matching [options], newest first — or `null` when
/// the host could not answer.
///
/// Asked of the host with its filters rather than read off the whole log:
/// the answer is a handful of rows from an indexed query instead of every
/// contact in a multi-thousand-QSO contest log, on a path that runs for each
/// lookup pass of each callsign. Enough rows to step past contacts whose
/// exchange was left blank to the one that was not.
///
/// A host with no log access answers `[]` and is no failure. A rejection is:
/// a malformed option, a database error, a bridge failure. It is reported and
/// answered as `null` rather than thrown, because a throw fails this whole
/// hook and freezes every extension's per-QSO controls on the panel — and
/// kept apart from `[]`, because "could not ask" must not read as "never
/// worked them", which would let an earlier running answer over what the
/// operator copied minutes ago.
async function callHistory(
  ctx: HookContext,
  call: string,
  options: Record<string, JSONValue>,
): Promise<Record<string, JSONValue>[] | null> {
  if (!ctx.getHistoryForCall) return []
  try {
    return await ctx.getHistoryForCall(call, { limit: 10, ...options })
  } catch (e) {
    console.warn(`[qso-party] call history unavailable, no earlier exchange offered:`, e)
    return null
  }
}

/// What [call] sent us before: in this operation, else in an earlier running
/// of this event.
///
/// This operation's comes first and is taken as it is — the operator copied
/// it from this station minutes ago. An earlier running is found by the
/// event's ref type, which its operations carry, and has to still hold
/// (`pastExchangeHolds`): the station can have moved.
async function priorExchange(
  ctx: HookContext,
  party: Party,
  call: string,
  operationUuid: string,
  options: { code: string }[],
  guessedState: string,
): Promise<string> {
  if (!operationUuid) return ''
  const here = await callHistory(ctx, call, { operation: operationUuid, refType: party.refType })
  // Could not ask about this operation: an earlier running must not answer
  // over what may be in it.
  if (here === null) return ''
  const found = loggedExchangeFor(party, here, call)
  if (found) return found
  const before = await callHistory(ctx, call, { refType: party.refType, excludeOperation: operationUuid })
  return loggedExchangeFor(party, before ?? [], call, (location) => pastExchangeHolds(party, options, guessedState, location))
}

/// The English an operator reads where the party's own translator says nothing.
/// Every key here is a key of `QsoPartyLabels` — which is the only place a
/// party overrides one, and the reason no default is written down twice.
const LABELS = {
  classNone: 'Not declared',
  countyLineHelp: 'This event allows county-line operation',
  lastUpdated: '**Data last updated:**',
  mobileHelp: 'Roving? Type BREAK and change your county each time you move.',
  mode: 'Mode',
  operator: 'Entry Class',
  ourEmail: 'E-mail for the log submission',
  ourName: 'Our Name',
  ourSerial: 'Our #',
  overlay: 'Overlay',
  period: '**Period:**',
  power: 'Power',
  station: 'Station',
  status: '**Status:**',
  theirLocation: 'QP Location',
  theirLocationShort: 'QP Loc',
  theirName: 'Name',
  theirSerial: 'Their #',
  ourLocation: 'Our QP Location',
}

/// The party's own translator over the engine's English, for the whole of one
/// hook call. The key set is `LABELS`, so a label with no English default
/// cannot be asked for.
function labelsFor(party: Party, ctx: HookContext): (key: keyof typeof LABELS) => string {
  return (key) => resolveLabel(party.labels[key], ctx, LABELS[key])
}

/// What one CLASS is called. A class the party leaves untranslated reads as the
/// engine's English rather than as its Cabrillo code.
function classLabel<C extends string>(
  overrides: Partial<Record<C, QsoPartyLabel>> | undefined,
  english: Record<C, string>,
  code: C,
  ctx: HookContext,
): string {
  return resolveLabel(overrides?.[code], ctx, english[code])
}

const OPERATOR_LABELS: Record<OperatorClass, string> = {
  'SINGLE-OP': 'Single Operator',
  'SINGLE-OP-ASSISTED': 'Single Operator, Assisted',
  'MULTI-ONE': 'Multi Operator, One Transmitter',
  'MULTI-TWO': 'Multi Operator, Two Transmitters',
  'MULTI-UNLIMITED': 'Multi Operator, Multiple Transmitters',
}

const POWER_LABELS: Record<PowerClass, string> = {
  QRP: 'QRP',
  LOW: 'Low Power',
  HIGH: 'High Power',
}

const STATION_LABELS: Record<StationClass, string> = {
  FIXED: 'Fixed',
  MOBILE: 'Mobile',
  PORTABLE: 'Portable',
  ROVER: 'Rover',
  EXPEDITION: 'Expedition',
  'COUNTY-LINE': 'County Line',
  SCHOOL: 'School',
  CLUB: 'Club',
  EOC: 'Emergency Operations Center',
}

const MODE_LABELS: Record<ModeClass, string> = {
  CW: 'CW',
  PHONE: 'Phone',
  DIGITAL: 'Digital',
  MIXED: 'Mixed',
}

const OVERLAY_LABELS: Record<OverlayClass, string> = {
  ROOKIE: 'Rookie',
  YOUTH: 'Youth',
  YL: 'YL',
  'NOVICE-TECH': 'Novice / Technician',
  'NEW-CONTESTER': 'New Contester',
  'TB-WIRES': 'Tribander / Wires',
  POTA: 'POTA',
}

/// `2026-10-17`. Written out rather than localized: these are the sponsor's UTC
/// contest dates, and an operator comparing them against a rule book wants them
/// in the same form the rule book uses.
export function fmtUtcDate(millis: number): string {
  if (!millis) return '—'
  const at = new Date(millis)
  const pad = (value: number) => `${value}`.padStart(2, '0')
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
}

/// `2026-10-17 14:00Z` — the same date with the hour the party opens, for the
/// information panel, where the exact hour is what an operator is checking.
function fmtUtcDay(millis: number): string {
  if (!millis) return '—'
  const at = new Date(millis)
  const pad = (value: number) => `${value}`.padStart(2, '0')
  return `${fmtUtcDate(millis)} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}Z`
}

/// What the activity row shows beneath the party's name: the party, and the day
/// it runs.
///
/// The date is the point of the line — an operator scanning a list of parties is
/// choosing by WHEN. Used by both `suggest` and `decorateRef`, which have to
/// agree: a suggestion is persisted verbatim without ever calling `decorateRef`,
/// so a subtitle composed differently in the two places would have the same
/// operation read differently depending on how it was added.
export function partySubtitle(party: Party): string {
  const start = party.periods[0]?.startMillis ?? 0
  return start ? `${party.name} • ${fmtUtcDate(start)}` : party.name
}

/// `New York QSO Party 2026` — the year matters in a label, since the same party
/// comes round every year.
///
/// The year is the one the PARAMS name, not the year the label happens to be
/// rendered in: an operation run in October 2026 would otherwise have its
/// activity row relabelled 2027 the moment the calendar turned, which is a claim
/// about the log that nothing in the log supports.
export function partyLabel(party: Party): string {
  const year = new Date(party.periods[0]?.startMillis || Date.now()).getUTCFullYear()
  return `${party.name} ${year}`
}

/// How near this party is, 0..1 — the activity search's ranking.
///
/// A party whose published dates have all passed is waiting for next year's
/// update, and ranks as though it were a year off rather than as "running now".
function relevanceOf(party: Party, nowMillis: number): number {
  if (hasAlreadyRun(party, nowMillis)) return 1 / (1 + 365 / 60)
  const days = daysUntil(party, nowMillis)
  if (days <= 0) return 1
  // Halves roughly every two months, so this weekend clearly beats next month
  // and the far end of the year doesn't crowd anything out.
  return 1 / (1 + days / 60)
}

function infoMarkdown(party: Party, ctx: HookContext): string {
  const t = labelsFor(party, ctx)
  const lines: string[] = []
  if (party.url) lines.push(`[${party.url}](${party.url})`)
  // Each period in full rather than folded into one range: a party that runs
  // Saturday afternoon and Sunday morning has a gap in the middle, and one range
  // spanning it would claim hours the sponsor does not score.
  for (const period of party.periods) {
    lines.push(`${t('period')} ${fmtUtcDay(period.startMillis)} — ${fmtUtcDay(period.endMillis)}`)
  }
  // `status` and `lastUpdated` describe the DATA, which is what an operator
  // needs to judge how far to trust the dates and the county list. Their TEXT is
  // the party's own note, so only the heading goes through the translator.
  if (party.status) lines.push(`${t('status')} ${party.status}`)
  if (party.lastUpdated) lines.push(`${t('lastUpdated')} ${party.lastUpdated}`)
  return lines.join('\n\n')
}

/// One select per axis the party publishes.
///
/// NOTHING is defaulted. Every one of these is a claim about how we operated: it
/// goes into the submitted log's `CATEGORY-` lines, and for the parties with a
/// power table it multiplies the score. A guess would either misstate the entry
/// to a checker or invent a multiplier the sponsor would not award — so an
/// unanswered question stays unanswered, and both readers treat it as no claim.
function entryClassElements(
  party: Party,
  ref: Record<string, unknown> | undefined,
  ctx: HookContext,
): FormElement[] {
  const elements: FormElement[] = []
  const classes = party.entryClasses
  const t = labelsFor(party, ctx)
  const labels = party.labels

  const select = (
    key: string,
    label: string,
    value: string | undefined,
    options: { value: string; label: string }[],
  ) => {
    if (options.length === 0) return
    elements.push({
      type: 'field',
      fieldType: 'select',
      key,
      label,
      value: value ?? '',
      // "Not declared" first, and the value a fresh setup keeps.
      options: [{ value: '', label: t('classNone') }, ...options],
    })
  }

  select('operator', t('operator'), ourOperatorClass(party, undefined, ref),
    classes.operator.map((code) => ({
      value: code,
      label: classLabel(labels.operatorClasses, OPERATOR_LABELS, code, ctx),
    })))

  select('power', t('power'), ourPowerClass(party, undefined, ref),
    classes.power.map((code) => {
      // The watts are the party's own, and the multiplier is shown where there
      // is one, because that is the operator's reason to care.
      const limit = classes.powerLimits[code]
      const mult = party.powerMultipliers[code]
      const detail = [limit, mult !== undefined && mult !== 1 ? `×${mult}` : ''].filter((x) => x).join(' • ')
      const name = classLabel(labels.powerClasses, POWER_LABELS, code, ctx)
      return { value: code, label: detail ? `${name} — ${detail}` : name }
    }))

  select('station', t('station'), ourStationClass(party, undefined, ref),
    classes.station.map((code) => ({
      value: code,
      label: classLabel(labels.stationClasses, STATION_LABELS, code, ctx),
    })))

  select('mode', t('mode'), ourModeClass(party, undefined, ref),
    classes.mode.map((code) => ({
      value: code,
      label: classLabel(labels.modeClasses, MODE_LABELS, code, ctx),
    })))

  select('overlay', t('overlay'), ourOverlayClass(party, undefined, ref),
    classes.overlay.map((code) => ({
      value: code,
      label: classLabel(labels.overlayClasses, OVERLAY_LABELS, code, ctx),
    })))

  // Said once, next to the station class that makes it true, rather than as a
  // standing instruction: a rover's county changes through segments.
  if (classes.station.some((code) => ROVING_STATION_CLASSES.includes(code))) {
    elements.push({ type: 'markdown', text: t('mobileHelp') })
  }

  return elements
}

export function qsoPartyActivity(params: QsoPartyParams): ActivityHook {
  const party = resolveParty(params)

  return {
    /// One suggestion, for this party: the operator finds it by the sponsor's
    /// name, its short name, or a state it covers.
    ///
    /// Everything the app displays is carried HERE: the suggestion path persists
    /// what this returns verbatim and never calls `decorateRef`, so a ref added
    /// by tapping a suggestion would otherwise reach the activities row with
    /// nothing but a code.
    async suggest({ searchTerm, scoped }: SuggestArgs, _ctx: HookContext): Promise<ActivitySuggestion[]> {
      const term = (searchTerm ?? '').trim().toUpperCase()
      const namesThisParty = !term
        || party.short.toUpperCase().includes(term)
        || party.name.toUpperCase().includes(term)
        // The state, or ANY of the states a party spanning several of them
        // spans: an operator in Massachusetts looks for the New England party
        // by where they are, and neither its name nor its short name says
        // Massachusetts.
        //
        // Equality where the names match on substring, because a state code is
        // two characters: `IN` inside a longer word would answer for Indiana in
        // half the searches an operator types.
        || party.state?.toUpperCase() === term
        || !!party.states?.some((state) => state.toUpperCase() === term)
        || party.refType.toUpperCase().includes(term)
      // Not ours, and nobody asked us in particular.
      if (!namesThisParty && !scoped) return []

      // No `ref` field. The TYPE names the party — one extension is one party —
      // so a second key holding the same fact could only ever disagree with it.
      return [{
        type: party.refType,
        name: partySubtitle(party),
        program: 'Contest',
        label: partyLabel(party),
        shortLabel: party.short,
        // Nearer ranks higher — running now, this weekend, next month.
        relevance: relevanceOf(party, Date.now()),
      }]
    },

    /// Where we are operating from, and the claims a submitted log has to carry.
    ///
    /// A `form`, not the `options` field the entry row uses: operation settings
    /// render `refList` and `form` and silently drop every other kind. The
    /// location is a plain text field — which a county LINE needs anyway, since
    /// it is two counties and a separator rather than one choice from a list.
    async operationControls(
      { operation }: { operation: Record<string, JSONValue> },
      ctx: HookContext,
    ): Promise<LoggingControlDescriptor[]> {
      const ref = partyRefIn(party, operation as Record<string, unknown>)
      const t = labelsFor(party, ctx)

      // A station outside the US and Canada has one answer, so it is offered
      // rather than asked — the same entities `normalizeLocation` reads as DX.
      const ourEntity = entityPrefixForCall(str(operation.stationCall)).toUpperCase()
      const weAreDx = ourEntity !== '' && ourEntity !== 'K' && ourEntity !== 'VE' && !stateForEntity(party, ourEntity)

      const elements: FormElement[] = [
        {
          type: 'field',
          fieldType: 'text',
          key: 'location',
          label: t('ourLocation'),
          value: ourLocationText(party, undefined, ref) || (weAreDx ? 'DX' : ''),
          placeholder: Object.keys(party.counties)[0],
          uppercase: true,
          // Counties inside the party, states and provinces outside it — the
          // same list an exchange from a station not yet looked up is checked
          // against, which already leaves out the party's own states, the one
          // mistake the scorer alerts on. And `DX`, which `parseOurLocations`
          // accepts in every party.
          //
          // A county line is a line between the party's OWN counties, so
          // everything else is only valid on its own. A host older than
          // `suggestions` renders the plain text field.
          suggestions: [...exchangeOptionsFor(party, undefined), { code: 'DX' }].map((option) =>
            party.counties[option.code] === undefined ? { ...option, standalone: true } : option,
          ),
          ...(party.countyLine
            ? {
                multiValue: {
                  separator: COUNTY_LINE_SEPARATOR,
                  ...(exchangeInheritPrefix(party) ? { inheritPrefix: exchangeInheritPrefix(party) } : {}),
                },
                // A comma, which `splitLocations` reads as a separator too,
                // written as the slash the field splits on.
                transforms: exchangeTransforms(party),
              }
            : {}),
        },
      ]

      if (party.countyLine) elements.push({ type: 'markdown', text: t('countyLineHelp') })
      if (party.exchange.name) {
        elements.push({
          type: 'field',
          fieldType: 'text',
          key: 'ourName',
          label: t('ourName'),
          value: ourName(party, undefined, ref),
        })
      }
      // The classes THIS party publishes, and only those: an axis a sponsor does
      // not classify by is a question with no answer, and the operator should not
      // be made to look at it.
      for (const element of entryClassElements(party, ref, ctx)) elements.push(element)

      elements.push({
        type: 'field',
        fieldType: 'email',
        key: 'email',
        label: t('ourEmail'),
        value: ourEmail(party, undefined, ref),
      })

      elements.push({ type: 'markdown', text: infoMarkdown(party, ctx) })

      return [
        {
          key: `${party.refType}/setup`,
          label: party.short,
          icon: party.icon,
          color: party.accentColor,
          order: 10,
          input: {
            kind: 'form',
            refType: party.refType,
            // The legacy pairs this party answers for, in the app's own claim
            // vocabulary (`qp/ny`, the manifest's `ref:qp/ny` without the
            // prefix). The manifest decides who is OFFERED for a reference
            // nothing handles; this decides who answers once they are on, and
            // a control that published only its own type would leave the row
            // red for the operator who just installed the fix.
            ...(party.legacyRefs?.length
              ? { alsoHandles: party.legacyRefs.map((claim) => `${claim.type}/${claim.prefix}`) }
              : {}),
            form: { title: party.short, elements },
          },
        },
      ]
    },

    /// The exchange: what they send us. A location always; a serial for the
    /// parties that number their contacts, and a name for those that trade them.
    async loggingControls(
      { operation, qso }: { operation: Record<string, JSONValue>; qso?: Record<string, JSONValue> },
      ctx: HookContext,
    ): Promise<LoggingControlDescriptor[]> {
      const controls: LoggingControlDescriptor[] = []
      const chrome = { icon: party.icon, color: party.accentColor }
      const t = labelsFor(party, ctx)

      if (party.exchange.number) {
        controls.push({
          key: `${party.refType}/ourSerial`,
          label: t('ourSerial'),
          ...chrome,
          order: 10,
          input: { kind: 'serial', refType: party.refType, field: 'ourSerial', sequence: { key: 'serial' } },
        })
        controls.push({
          key: `${party.refType}/theirSerial`,
          label: t('theirSerial'),
          ...chrome,
          order: 20,
          input: { kind: 'text', refType: party.refType, field: 'theirSerial', numeric: true, maxLength: 5 },
        })
      }

      if (party.exchange.name) {
        controls.push({
          key: `${party.refType}/theirName`,
          label: t('theirName'),
          ...chrome,
          order: 30,
          input: { kind: 'text', refType: party.refType, field: 'theirName', maxLength: 12 },
        })
      }

      const guessedState = qso ? guessedStateOf(qso as Record<string, unknown>) : ''
      const options = exchangeOptionsFor(party, qso)
      // Only asked for when there is a callsign: this hook is also called with
      // no QSO at all, and none of those callers can use the answer.
      const call = str((qso?.their as Record<string, JSONValue> | undefined)?.call)
      const logged = call ? await priorExchange(ctx, party, call, str(operation.uuid), options, guessedState) : ''
      // Otherwise the value an empty exchange is scored and filed as anyway,
      // so a prefill left alone changes nothing about the log.
      const hint = defaultTheirLocation(party, (qso ?? {}) as Record<string, JSONValue>)
      // Except an in-party caller's own state: it is not an exchange anyone
      // sends, so it is shown as a hint — which New York station this is —
      // while the county goes in the field. Ruled out by name rather than by
      // "not in the list": a station with no list (DX, or Alaska and Hawaii
      // where the party counts them as DX) has nothing to check it against.
      const hintIsExchange = !partyStates(party).has(hint) &&
        (options.length === 0 || options.some((option) => option.code === hint))
      const suggested = logged || (hintIsExchange ? hint : '')
      const placeholder = suggested ? '' : hint
      const inheritPrefix = exchangeInheritPrefix(party)
      controls.push({
        key: `${party.refType}/location`,
        label: t('theirLocation'),
        shortLabel: t('theirLocationShort'),
        ...chrome,
        order: 40,
        input: {
          kind: 'options',
          refType: party.refType,
          field: 'location',
          options,
          // Hold the line back until the second character: a county code is three
          // or five, and on one character every callsign lookup would paint a
          // slice of the whole county list.
          minCharsForSuggestions: 2,
          // A county line is up to three codes and their separators, so the
          // field is longer than any one of them — and DX entity prefixes can
          // be four.
          maxLength: party.countyLine ? 18 : 6,
          // The guessed state's counties float up for the caller who sends one
          // of those — a county is never guessed, only ranked.
          preferredCodes: preferredCodesFor(party, guessedState),
          // Written in where it is an exchange, hinted where it is not — see
          // `suggested` and `placeholder` above.
          ...(suggested ? { suggestedValue: suggested } : {}),
          ...(placeholder ? { placeholder } : {}),
          ...(party.countyLine
            ? {
              multiValue: {
                separator: COUNTY_LINE_SEPARATOR,
                ...(inheritPrefix ? { inheritPrefix } : {}),
              },
              transforms: exchangeTransforms(party),
            }
            : {}),
          // A station in no known entity may still send something we don't have a
          // list for — a party's counties may be a year behind a split — and for
          // DX stations the list is empty, so the value is whatever was heard.
          allowFreeform: options.length === 0,
        },
      })

      return controls
    },

    /// Mirrors the exchange into `their.exchange` (the column the QSO list shows,
    /// and the only generic field anything outside this extension reads) and
    /// what WE sent into `our.exchange`. `operation` is the segment-effective
    /// one for this contact, so an edit of an old contact re-projects what was
    /// true then — see the note about exports and segments in `exports.ts`.
    async processQsoBeforeSave(
      { qso, operation }: { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> },
      _ctx: HookContext,
    ): Promise<Record<string, JSONValue> | null> {
      const qsoRef = partyRefIn(party, qso as Record<string, unknown>)
      const location = str(qsoRef?.location).trim().toUpperCase()
      const serial = serialOf(qsoRef?.theirSerial)
      const name = str(qsoRef?.theirName).trim().toUpperCase()
      const ours = ourLocationText(party, operation as Record<string, unknown>)

      const exchange = [serial, name, location].filter((part) => part).join(' ')

      // PRESENCE, not truthiness. `their.exchange` is one field shared by every
      // activity on the operation, and `mergeQsoPatch` merges `their` one level
      // deep, so projecting an empty string unconditionally writes `''` over
      // whatever a co-active activity has just put there — and a DX contact makes
      // it every time, since no party asks a DX station to send anything.
      const decided = qsoRef !== undefined
        && ['location', 'theirSerial', 'theirName'].some((field) => field in qsoRef)

      // Re-projected on every save, edits included: the host hands this hook
      // the operation that was true when the contact was made, so a rover who
      // fixes a callsign typo an hour later gets that contact's own county back,
      // not the one they have driven to. (An `ourLocation` stamp an earlier
      // build left on the ref is not read — the segment is the record.)
      const ourExchange = [
        serialOf(qsoRef?.ourSerial),
        ourName(party, operation as Record<string, unknown>),
        ours,
      ].filter((part) => part).join(' ')

      const patch: Record<string, JSONValue> = {}
      // A deliberate blank still projects, so clearing an exchange on an edit
      // clears the QSO row's column too — but only where this extension owns the
      // field's contents.
      if (exchange || decided) patch.their = { exchange }
      // What WE sent: an operator reading an old contact wants both halves of it.
      if (ourExchange) patch.our = { exchange: ourExchange }

      // Nothing to say, said as nothing: a hook that answers with a patch it did
      // not mean is a hook that overwrites its neighbours.
      return Object.keys(patch).length > 0 ? patch : null
    },
  }
}
