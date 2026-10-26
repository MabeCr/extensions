// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Ohio State Parks On The Air — the Portage County Amateur Radio Service's
// contest on the first Saturday after Labor Day (https://ospota.org).
//
// One extension, one event: the ref's TYPE is the whole of its identity and it
// carries no `ref` field. Operations logged under the combined State Parks
// extension carry `{type: 'stateparks', ref: 'OHSP'}` instead, and are answered
// for as they stand (event.ts, `LEGACY_CLAIM`).
//
// Unlike the other state-park events this one has an EXCHANGE: a station in a
// park sends its three-letter identifier, so there is an entry-row field for it
// — 76 codes, searched — and a POTA reference only offers a value for it. What
// the sponsor takes is a Cabrillo and nothing else, its header carrying the
// entry category and power, which is why setup asks for both. The rules are in
// scorer.ts, and what each side's park is, in parks.ts.

import { qsonToCabrillo } from "@ham2k/lib-qson-cabrillo"
import { stampedExchange } from "@ham2k/lib-contest-exchange"
import { contestScorer, defineExtension, exportFilename, exportTypeDefinition, operationForQso, startMillisOf } from "@ham2k/extension-sdk"
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

import { cabrilloPower, declaredCategory, declaredPower } from "./entry.ts"
import {
  CABRILLO_NAME, CATEGORIES, END_MILLIS, LEGACY_CLAIM, LEGACY_KEY, LEGACY_TYPE, NAME, NOT_IN_A_PARK,
  PARKS, PARK_BY_ABBREVIATION, POWER_CLASSES, START_MILLIS, TYPE, URL,
} from "./event.ts"
import { tFor } from "./i18n.ts"
import { configuredOurPark, eventRefIn, exchangeRefIn, guessedPark, ourPark, theirExchange, theirPark } from "./parks.ts"
import { OhspotaScorer } from "./scorer.ts"

import manifest from "../manifest.json" with { type: "json" }

const DAY_MILLIS = 24 * 60 * 60 * 1000

function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

/// `Ohio State Parks On The Air 2026`. The year is the one the dates name, not
/// the year the label is rendered in: an operation run in September would
/// otherwise be relabelled the moment the calendar turned.
const LABEL = `${NAME} ${new Date(START_MILLIS).getUTCFullYear()}`

/// The activity row's subtitle for an operation with no park set up. `suggest`
/// and `decorateRef` both use it: a suggestion is persisted verbatim without
/// `decorateRef` ever being called, so two wordings would have one operation
/// read differently by how it was added.
const SUBTITLE = `${NAME} • ${fmtUtcDate(START_MILLIS)}`

function fmtUtcDate(millis: number): string {
  const at = new Date(millis)
  const pad = (value: number) => `${value}`.padStart(2, '0')
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
}

/// `2026-09-12 14:00Z`. Written out rather than localized: these are the
/// sponsor's UTC hours, and an operator checking them against the rules wants
/// them in the rules' own form.
function fmtUtcDay(millis: number): string {
  const at = new Date(millis)
  const pad = (value: number) => `${value}`.padStart(2, '0')
  return `${fmtUtcDate(millis)} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}Z`
}

/// How near the event is, 0..1 — the activity search's ranking. Dates more than
/// two weeks gone are waiting for next year's update, and rank as a year off
/// rather than as "running now".
function relevanceAt(nowMillis: number): number {
  if (nowMillis > END_MILLIS + 14 * DAY_MILLIS) return 1 / (1 + 365 / 60)
  const days = Math.ceil((START_MILLIS - nowMillis) / DAY_MILLIS)
  if (days <= 0) return 1
  // Halves roughly every two months, so this weekend clearly beats next month.
  return 1 / (1 + days / 60)
}

const ActivityHook = {
  /// Everything the app displays is carried HERE: the suggestion path persists
  /// what this returns verbatim and never calls `decorateRef`.
  async suggest({ searchTerm, scoped }: SuggestArgs, _ctx: HookContext): Promise<ActivitySuggestion[]> {
    const term = (searchTerm ?? '').trim().toUpperCase()
    const namesUs = !term
      || manifest.shortName.includes(term)
      || NAME.toUpperCase().includes(term)
      || LEGACY_KEY.includes(term)
      // Equality, because a state code is two characters: `OH` inside a longer
      // word would answer for Ohio in half the searches an operator types.
      || term === 'OH'
    if (!namesUs && !scoped) return []

    return [{
      type: TYPE,
      name: SUBTITLE,
      program: 'Contest',
      label: LABEL,
      shortLabel: manifest.shortName,
      relevance: relevanceAt(Date.now()),
    }]
  },

  /// Which park we are working from, and the two claims the Cabrillo carries.
  ///
  /// A `form`, not `options`: operation settings render `refList` and `form` and
  /// silently drop every other kind, and the form schema has no searchable
  /// single select. 76 parks in a `select` is a long list to scroll — acceptable
  /// because it is answered once per operation, and usually not at all, since a
  /// POTA activation already says which park this is.
  async operationControls(
    { operation }: { operation: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<LoggingControlDescriptor[]> {
    const t = tFor(ctx)
    const ref = eventRefIn(operation)

    const elements: FormElement[] = [
      {
        type: 'field',
        fieldType: 'select',
        key: 'ourPark',
        label: t('ourParkLabel'),
        // Only a DEFAULT: the renderer prefers the value already on the ref, so
        // this fills in the park the operator is activating without ever
        // overwriting a choice they made. Computed when the sheet opens, so a
        // POTA activation added in the same sitting won't be seen — the form
        // has no way to be told, and the operator can still pick from the list.
        value: ourPark(operation) || undefined,
        options: PARKS.map((park) => ({ value: park.abbreviation, label: `${park.abbreviation} — ${park.name}` })),
      },
      // Neither is defaulted. Both are claims about how we operated, put in
      // front of the sponsor's log checker — so unanswered stays unanswered, and
      // the Cabrillo then carries no such header (entry.ts).
      {
        type: 'field',
        fieldType: 'select',
        key: 'ourPower',
        label: t('ourPowerLabel'),
        value: declaredPower(ref) || undefined,
        options: POWER_CLASSES.map((power) => ({ value: power.value, label: `${t(`power${power.value}`)} — ${power.watts}` })),
      },
      {
        type: 'field',
        fieldType: 'select',
        key: 'ourCategory',
        label: t('ourCategoryLabel'),
        value: declaredCategory(ref)?.value,
        options: CATEGORIES.map((category) => ({ value: category.value, label: `${category.value} — ${category.description}` })),
      },
      {
        type: 'markdown',
        text: [
          `[${URL}](${URL})`,
          t('period', { period: `${fmtUtcDay(START_MILLIS)} — ${fmtUtcDay(END_MILLIS)}` }),
          t('scoring'),
          t('submit'),
        ].join('\n\n'),
      },
    ]

    return [
      {
        key: `${TYPE}/setup`,
        label: manifest.shortName,
        icon: manifest.icon,
        color: manifest.accentColor,
        order: 10,
        input: {
          kind: 'form',
          refType: TYPE,
          // The legacy reference this control ANSWERS for once the extension is
          // on; the manifest says who is OFFERED for it, and a control that
          // published only its own type would leave that row red.
          alsoHandles: [LEGACY_CLAIM],
          form: { title: manifest.shortName, elements },
        },
      },
    ]
  },

  /// The park identifier the station we are working sends.
  async loggingControls(
    { operation, qso }: { operation: Record<string, JSONValue>; qso?: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<LoggingControlDescriptor[]> {
    if (!eventRefIn(operation)) return []

    // A park already hunted on this QSO says which park they are in, so offer
    // it — the operator logged `US-1958` and the exchange is `HOC`. The core's
    // suggestion rule means a typed value always wins, and an accepted
    // suggestion is genuinely saved.
    const suggested = qso ? theirPark(qso) : ''

    return [
      {
        key: `${TYPE}/park`,
        label: tFor(ctx)('theirParkLabel'),
        icon: manifest.icon,
        color: manifest.accentColor,
        order: 10,
        input: {
          kind: 'options',
          refType: TYPE,
          field: 'park',
          options: PARKS.map((park) => ({ code: park.abbreviation, name: park.name })),
          // A code is three letters; hold the list back until the second, or
          // every callsign lookup paints a third of the park list.
          minCharsForSuggestions: 2,
          maxLength: 4,
          suggestedValue: suggested || undefined,
        },
      },
    ]
  },

  /// Mirrors the park into `their.exchange`, which is the column the QSO list
  /// shows and the only generic field anything outside this extension reads.
  async processQsoBeforeSave(
    { qso, operation }: { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> },
    _ctx: HookContext,
  ): Promise<Record<string, JSONValue> | null> {
    if (!eventRefIn(operation)) return null

    // Read from whichever shape the contact's ref has, and stamped under OUR
    // type: a patch ref of a type this extension does not publish is dropped
    // by the app, and the readers look for this one first. Read as typed, not
    // validated — `theirExchange` and the exports show it the same way.
    return stampedExchange(TYPE, exchangeRefIn(qso), {
      park: { read: (value) => str(value).toUpperCase(), guess: () => guessedPark(qso) },
    }, ({ park }) => park)
  },
}

const RefHandler = {
  /// Nothing to check, and nothing to normalize: a `normalized` here is written
  /// into the ref's own `ref` field, which a legacy reference needs kept as it
  /// is and this event's own type does not have.
  async validateRef(_args: { ref: Ref }, _ctx: HookContext) {
    return { valid: true }
  },

  async decorateRef({ ref }: { ref: Ref }, _ctx: HookContext): Promise<Ref> {
    const park = configuredOurPark(undefined, ref as Record<string, JSONValue>)
    return {
      ...ref,
      program: 'Contest',
      label: LABEL,
      shortLabel: park ? `${manifest.shortName}: ${park}` : manifest.shortName,
      name: PARK_BY_ABBREVIATION[park]?.name ?? SUBTITLE,
    }
  },

  /// "KI2D for OSPOTA" with the park beneath it.
  async suggestOperationTitle(
    { operation }: { ref: Ref; operation: Record<string, JSONValue> },
    _ctx: HookContext,
  ): Promise<TitleSuggestion | null> {
    const park = ourPark(operation)
    return { for: manifest.shortName, subtitle: PARK_BY_ABBREVIATION[park]?.name }
  },

  async linkForRef(_args: { ref: Ref }, _ctx: HookContext): Promise<RefLink | null> {
    return { url: URL, label: NAME }
  },
}

const AdifFieldsHook = {
  /// The contest and its exchange. These reach only the FULL ADIF export — the
  /// sponsor takes no ADIF — and the park references there are POTA's fields,
  /// contributed by that extension.
  async fieldsForOneQSO(
    { qso, operation }: { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> },
    _ctx: HookContext,
  ): Promise<{ name: string; value: string }[]> {
    if (!eventRefIn(operation)) return []

    const fields = [{ name: 'CONTEST_ID', value: LEGACY_KEY }]
    const ours = ourPark(operation)
    const theirs = theirExchange(qso)
    if (ours) fields.push({ name: 'STX_STRING', value: ours })
    if (theirs) fields.push({ name: 'SRX_STRING', value: theirs })
    return fields
  },
}

const CABRILLO_EXPORT = `${TYPE}-cabrillo`

function filenameFor(args: ExportOptionsRequest | ExportRequest): string {
  return exportFilename({
    stationCall: args.operation.stationCall,
    activity: manifest.shortName,
    startAtMillis: startMillisOf(args.operation, args.qsos ?? []),
    extension: 'log',
    compact: args.compactFilenames,
  })
}

/// The other station's Cabrillo location, by the sponsor's exchange rules: their
/// park; else, in the US, their state — `NOT` for Ohio's own, the word an Ohio
/// station in no park sends; else `DX`, "all of Canada and Mexico" included.
function theirCabrilloLocation(qso: Record<string, JSONValue>): string {
  const park = theirPark(qso)
  if (park) return park

  const their = (qso.their as Record<string, JSONValue>) ?? {}
  const guess = (their.guess as Record<string, JSONValue>) ?? {}
  const entity = str(their.entityPrefix) || str(guess.entityPrefix)
  // "KH/KL Hawaii and Alaska are US States".
  if (!['K', 'KH6', 'KL'].includes(entity)) return 'DX'
  const state = str(their.state) || str(guess.state)
  return !state || state.toUpperCase() === 'OH' ? NOT_IN_A_PARK : state.toUpperCase()
}

const ExportHook = {
  async getExportTypes() {
    return [exportTypeDefinition(TYPE, 'cabrillo', manifest.shortName)]
  },

  /// A Cabrillo and nothing else: "No ADIF, no CSV, no Text files - send in a
  /// standard Cabrillo file only."
  async suggestExportOptions(args: ExportOptionsRequest, ctx: HookContext): Promise<ExportOption[]> {
    const ref = eventRefIn(args.operation)
    if (!ref) return []
    return [{
      exportType: CABRILLO_EXPORT,
      templateData: { activity: manifest.shortName },
      format: 'cabrillo',
      label: tFor(ctx)('cabrilloExport', { contest: manifest.shortName }),
      filename: filenameFor(args),
      selectedByDefault: true,
      // The type of the ref the operation ACTUALLY carries, so the file covers
      // the segments the contest ran in whichever shape named it.
      refType: str(ref.type),
    }]
  },

  async generateExport(args: ExportRequest, _ctx: HookContext): Promise<ExportResult> {
    // Only the exportType offered above: a hook answering for one it never
    // offered makes the ADIF delegation recurse.
    const ref = eventRefIn(args.operation)
    if (args.exportType !== CABRILLO_EXPORT || !ref) return { filename: '', mimeType: '', content: '' }

    const operation = args.operation
    const ourCall = str(operation.stationCall)
    const ours = ourPark(operation) || NOT_IN_A_PARK
    const category = declaredCategory(ref)

    const content = qsonToCabrillo(args.qsos, {
      // In the sponsor's own order, from their sample log
      // (https://ospota.org/Files/OSPOTA_Sample-rev2.log): the checker is
      // automated, and these four CATEGORY lines are what tells it which entry it
      // is scoring. Empty values are dropped by the writer.
      //
      // `CATEGORY-MODE` is fixed: the sponsor's sample has MIXED written in
      // rather than a placeholder, and their categories don't split by mode.
      // CLUB-NAME is in that sample too and is NOT emitted — their rules never
      // mention a club, so there is no field to fill it from.
      headers: [
        ['CONTEST', CABRILLO_NAME],
        ['CALLSIGN', ourCall],
        ['LOCATION', ours],
        ['CATEGORY-OPERATOR', category?.value],
        ['CATEGORY-TRANSMITTER', category?.transmitter],
        ['CATEGORY-POWER', cabrilloPower(ref)],
        ['CATEGORY-MODE', 'MIXED'],
        ['OPERATORS', str((operation.local as Record<string, JSONValue>)?.operatorCall)],
        ['GRID-LOCATOR', str(operation.grid)],
      ],
      // The sponsor's own layout: no signal reports, and a location column each
      // side. Ours is the park THIS contact was made from, which a segment moves.
      qsoParts: (qso) => [
        (ourCall || '-').padEnd(18, ' '),
        (ourPark(operationForQso(operation, qso, args.segments)) || NOT_IN_A_PARK).padEnd(12, ' '),
        (str(((qso.their as Record<string, JSONValue>) ?? {}).call) || '-').padEnd(17, ' '),
        theirCabrilloLocation(qso).padEnd(12, ' '),
      ],
    })
    return { filename: filenameFor(args), mimeType: 'text/plain', content }
  },
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook('activity', { hook: ActivityHook, key: manifest.key })
    registerHook(`ref:${TYPE}`, { hook: RefHandler, key: manifest.key })
    // The same handler under the legacy claim. The kernel resolves a
    // `ref:stateparks` call by the reference's own code, longest prefix first,
    // so the event a reference names answers it.
    registerHook(`ref:${LEGACY_CLAIM}`, { hook: RefHandler, key: manifest.key })
    registerHook('adifFields', { hook: AdifFieldsHook, key: manifest.key })
    registerHook('export', { hook: ExportHook, key: manifest.key })
    // The legacy type too, or an operation logged under the combined extension
    // scores nothing while its row sits there answered. The scope is a filter on
    // which operations REACH the scorer, not a claim: the other events' legacy
    // operations reach it as well, and `isOurRef` declines them.
    registerHook('scoring', {
      hook: contestScorer(OhspotaScorer, { scope: { refTypes: [TYPE, LEGACY_TYPE] } }),
      key: manifest.key,
    })
  },
})
