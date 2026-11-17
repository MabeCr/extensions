// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Texas State Parks On The Air — the Lake Area Amateur Radio Klub's April event
// (https://www.tspota.org).
//
// One extension, one event: the ref's TYPE is the whole of its identity and it
// carries no `ref` field. Operations logged under the combined State Parks
// extension carry `{type: 'stateparks', ref: 'TXSP'}` instead, and are answered
// for as they stand (event.ts, `LEGACY_CLAIM`).
//
// It is played THROUGH POTA: there is no exchange field at all, and the parks
// are the POTA refs the operator is already logging (parks.ts). The rules are
// in scorer.ts.
//
// What the sponsor takes is an ADIF whose FILENAME names the park (§8.4.1.1), so
// that file is ours to write rather than POTA's — one per park, since the name
// carries exactly one. Setup asks for the power class, which is a term in the
// score; the operating classes and the photo bonus are claimed on the sponsor's
// upload form and change nothing this produces.

import { adifForExport, contestScorer, defineExtension, segmentsWith, startMillisOf, utcDateCompact } from "@ham2k/extension-sdk"
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

import { declaredPower } from "./entry.ts"
import { END_MILLIS, LEGACY_CLAIM, LEGACY_KEY, LEGACY_TYPE, NAME, POWER_CLASSES, START_MILLIS, TYPE, URL } from "./event.ts"
import { tFor } from "./i18n.ts"
import { POTA_ACTIVATION, eventRefIn, ourParks } from "./parks.ts"
import { TxspotaScorer } from "./scorer.ts"

import manifest from "../manifest.json" with { type: "json" }

const DAY_MILLIS = 24 * 60 * 60 * 1000

/// `Texas State Parks On The Air 2026`. The year is the one the dates name,
/// not the year the label is rendered in: an operation run in April would
/// otherwise be relabelled the moment the calendar turned.
const LABEL = `${NAME} ${new Date(START_MILLIS).getUTCFullYear()}`

/// The activity row's subtitle. `suggest` and `decorateRef` both use it: a
/// suggestion is persisted verbatim without `decorateRef` ever being called, so
/// two wordings would have one operation read differently by how it was added.
const SUBTITLE = `${NAME} • ${fmtUtcDate(START_MILLIS)}`

function fmtUtcDate(millis: number): string {
  const at = new Date(millis)
  const pad = (value: number) => `${value}`.padStart(2, '0')
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
}

/// `2026-04-18 00:00Z`. Written out rather than localized: these are the
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
      // Equality, because a state code is two characters: `TX` inside a longer
      // word would answer for Texas in half the searches an operator types.
      || term === 'TX'
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

  /// The power class, and where the operator learns that the parks come from
  /// their POTA activation — the one thing about this event that is not obvious
  /// from its name.
  ///
  /// A `form`, because operation settings render `refList` and `form` and
  /// silently drop every other kind.
  async operationControls(
    { operation }: { operation: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<LoggingControlDescriptor[]> {
    const t = tFor(ctx)
    const power: FormElement = {
      type: 'field',
      fieldType: 'select',
      key: 'ourPower',
      label: t('ourPowerLabel'),
      // NOT defaulted. A power class is a claim about how we operated, and a
      // guess at one invents a multiplier the sponsor would not award — so
      // unanswered stays unanswered, and the scorer reads it as no claim.
      value: declaredPower(eventRefIn(operation)) || undefined,
      options: POWER_CLASSES.map((entry) => ({
        value: entry.value,
        label: `${t(`power${entry.value}`)} — ${entry.watts} • +${entry.adds}`,
      })),
    }
    const text = [
      t('addPota'),
      `[${URL}](${URL})`,
      t('period', { period: `${fmtUtcDay(START_MILLIS)} — ${fmtUtcDay(END_MILLIS)}` }),
      t('scoring'),
      t('bonuses'),
      t('submit'),
    ].join('\n\n')

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
          form: { title: manifest.shortName, elements: [power, { type: 'markdown', text }] },
        },
      },
    ]
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
    return { ...ref, program: 'Contest', label: LABEL, shortLabel: manifest.shortName, name: SUBTITLE }
  },

  /// "KI2D for TSPOTA". The park is POTA's to put in the title.
  async suggestOperationTitle(_args: { ref: Ref }, _ctx: HookContext): Promise<TitleSuggestion | null> {
    return { for: manifest.shortName }
  },

  async linkForRef(_args: { ref: Ref }, _ctx: HookContext): Promise<RefLink | null> {
    return { url: URL, label: NAME }
  },
}

const AdifFieldsHook = {
  /// Only the contest's name: the parks are POTA's fields (`MY_SIG_INFO`,
  /// `SIG_INFO`), contributed by that extension.
  async fieldsForOneQSO(
    { operation }: { operation: Record<string, JSONValue> },
    _ctx: HookContext,
  ): Promise<{ name: string; value: string }[]> {
    if (!eventRefIn(operation)) return []
    return [{ name: 'CONTEST_ID', value: LEGACY_KEY }]
  },
}

/// Namespaces this hook's per-park exportKey, and separates it from the ref.
/// Split by prefix LENGTH, never by searching for the colon: a reference can
/// contain one.
const PARK_ADIF = `${TYPE}-adif`
const SEPARATOR = ':'

/// `KE5CW@US-3051-20260418.adi` — §8.4.1.1: "a filename formatted as for POTA:
/// CALL@US-PARK_ID (ex. KE5CW@US-3051)", and the sponsor's FAQ allows that
/// "additional text can also be appended after the park number". The slash of a portable callsign becomes a
/// dash.
function parkFilename(operation: Record<string, JSONValue>, qsos: Record<string, JSONValue>[], park: string): string {
  const call = (typeof operation.stationCall === 'string' ? operation.stationCall : '').toUpperCase().replace(/\//g, '-') || 'UNKNOWN'
  // An operation with no contacts has no date of its own, and the name still
  // has to have one.
  const millis = startMillisOf(operation, qsos) ?? Date.now()
  return `${call}@${park}-${utcDateCompact(millis)}.adi`
}

const ExportHook = {
  async getExportTypes() {
    // Written out rather than built by `exportTypeDefinition`: that helper ties
    // the type to OUR activation, and this file is sliced by POTA's.
    return [{
      exportType: PARK_ADIF,
      format: 'adif',
      label: manifest.shortName,
      templateCategory: 'reference',
      templateSample: { log: { ref: 'US-1234', refName: 'Example Park' } },
      defaults: {
        filenameTemplate: '{{ log.station | dash }}@{{ log.ref }}-{{ op.dateCompact }}',
        compactFilenameTemplate: '{{ log.station | dash }}@{{ log.ref }}-{{ op.dateCompact }}',
      },
    }]
  },

  /// One file per listed park. §8.4.1.1 also takes a combined file, but only one
  /// whose every record carries `MY_SIG_INFO`; a file per park needs nothing but
  /// its name.
  async suggestExportOptions(args: ExportOptionsRequest, ctx: HookContext): Promise<ExportOption[]> {
    if (!eventRefIn(args.operation)) return []
    const t = tFor(ctx)

    return ourParks(args.operation).map((park) => ({
      exportType: PARK_ADIF,
      templateData: { activity: manifest.shortName, ref: park },
      exportKey: `${PARK_ADIF}${SEPARATOR}${park}`,
      format: 'adif',
      label: t('parkAdifExport', { contest: manifest.shortName, ref: park }),
      filename: parkFilename(args.operation, args.qsos ?? [], park),
      selectedByDefault: true,
      // The PARK's segments, not the event's: this file claims one park, so it
      // covers the stretch that park was being activated, where POTA's own
      // export covers every park the operation activated.
      refType: POTA_ACTIVATION,
      // Above POTA's own export, which for a single park under compact file
      // names produces this very filename. The panel generates in list order and the
      // core renames the SECOND file of a colliding pair, so being first is what
      // keeps the name the sponsor demands on the file that has to have it.
      priority: 1,
    }))
  },

  async generateExport(args: ExportRequest, _ctx: HookContext): Promise<ExportResult> {
    // Only the exportType offered above: a hook answering for one it never
    // offered makes the ADIF delegation recurse.
    if (args.exportType !== PARK_ADIF || !eventRefIn(args.operation)) return { filename: '', mimeType: '', content: '' }

    const exportKey = typeof args.exportKey === 'string' ? args.exportKey : ''
    if (!exportKey.startsWith(`${PARK_ADIF}${SEPARATOR}`)) throw new Error(`${TYPE}: unknown export key '${exportKey}'`)
    const wanted = exportKey.slice(PARK_ADIF.length + SEPARATOR.length)

    // Listed off the operation's refs and generated from them again a moment
    // later: remove the park in between and filtering to nothing would produce a
    // valid ADIF claiming no park at all, which is worse than failing because it
    // looks submittable.
    if (!ourParks(args.operation).includes(wanted)) {
      throw new Error(`${TYPE}: operation has no ${POTA_ACTIVATION} reference '${wanted}'`)
    }

    // The file names ONE park, so that is the only one the record fields may
    // name: the operation POTA's hook sees carries just this activation — on
    // every segment too, since the generator hands the hook each contact's own.
    const claimOnly = (operation: Record<string, JSONValue>): Record<string, JSONValue> => ({
      ...operation,
      refs: ((operation.refs as Record<string, JSONValue>[] | undefined) ?? []).filter(
        (r) => r?.type !== POTA_ACTIVATION || (typeof r.ref === 'string' && r.ref.toUpperCase() === wanted),
      ) as unknown as JSONValue,
    })

    const content = await adifForExport({
      operation: claimOnly(args.operation),
      qsos: args.qsos,
      segments: segmentsWith(args.segments, claimOnly),
      includePrivateData: args.includePrivateData,
      includeLookupData: args.includeLookupData,
      exportSettings: args.exportSettings,
      exportData: args.exportData,
      exportTitle: args.exportTitle,
      mainHandler: manifest.key,
      // POTA under both keys it is installed by — the catalog's copy and the one
      // the app bundles. Only one is ever present and an unmatched key
      // contributes nothing. `MY_SIG_INFO` and `SIG_INFO` are the two fields the
      // sponsor's uploader requires, and its one-record-per-hunted-park is what
      // the scorer counts (scorer.ts).
      includeFieldsFrom: ['ham2k-pota', 'pota'],
    })
    return { filename: parkFilename(args.operation, args.qsos, wanted), mimeType: 'text/plain', content }
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
      hook: contestScorer(TxspotaScorer, { scope: { refTypes: [TYPE, LEGACY_TYPE] } }),
      key: manifest.key,
    })
  },
})
