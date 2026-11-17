// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Wisconsin Parks on the Air — the Fox Cities Amateur Radio Club's contest on
// the third Saturday of September (https://wipota.com).
//
// One extension, one event, so nothing asks which: the ref's TYPE is the whole
// of its identity and it carries no `ref` field, the shape the per-event QSO
// parties take. Operations set up under this extension's first name carry
// `wipota` instead, and are answered for as they stand (`LEGACY_TYPE`).
//
// It is played THROUGH POTA, like the Texas, Florida and Georgia state-park
// events:
// a park station sends its US-POTA number, so there is no exchange field here at
// all and nothing to type. The parks are the POTA refs the operator is already
// logging (parks.ts), and the rules are in scorer.ts.
//
// What the sponsor wants back is their web form — three counts, which the score
// panel's arithmetic states — and an ADIF "for checking purposes",
// reading `MY_SIG_INFO` and `SIG_INFO`. Those are POTA's field names, written
// here from the parks the score counts rather than by POTA's hook (adif.ts).
//
// The five operating classes are claimed on that form and change nothing this
// produces, so setup does not ask for one.

import { adifForExport, contestScorer, defineExtension, exportFilename, exportTypeDefinition, startMillisOf } from "@ham2k/extension-sdk"
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
  TitleSuggestion,
} from "@ham2k/extension-sdk"

import { adifFieldsFor } from "./adif.ts"
import { tFor } from "./i18n.ts"
import { refOfType } from "./parks.ts"
import { WipotaScorer } from "./scorer.ts"

import manifest from "../manifest.json" with { type: "json" }

/// The ref type an operation stores. It is data in the operator's log, so it
/// never follows a rename of the package.
const TYPE = 'wispota'

/// The type this extension stored when it was `ham2k-wipota`. Those operations
/// are not migrated — a log is not an extension's to edit after the fact — so
/// every hook answers for both.
///
/// Plainly, not as a qualified `wipota/…` claim: those refs carry no code for a
/// prefix to match, so the only way the app finds a control for their row is a
/// control PUBLISHING the type (`controlsFor`).
const LEGACY_TYPE = 'wipota'
const TYPES = [TYPE, LEGACY_TYPE]

/// The event's ref on [operation], in either shape. Our own type wins where both
/// are present: that is the one the operator has set up since.
function eventRefIn(operation: Record<string, JSONValue> | undefined): Record<string, JSONValue> | undefined {
  return refOfType(operation, TYPE) ?? refOfType(operation, LEGACY_TYPE)
}

/// As the sponsor writes it. Not translated: it is a proper name.
const NAME = 'Wisconsin Parks on the Air'
const URL = 'https://wipota.com/'
const LOGS_URL = 'https://wipota.com/logs/'

/// "The 3rd Saturday in September each year for seven hours from 11 am until
/// 6 pm local/CDT, or 1600 to 2300 UTC" — this year's, which `relevance.dates`
/// in the manifest has to move with.
const START_MILLIS = Date.UTC(2026, 8, 19, 16, 0)
const END_MILLIS = Date.UTC(2026, 8, 19, 23, 0)

const DAY_MILLIS = 24 * 60 * 60 * 1000

/// `Wisconsin Parks on the Air 2026`. The year is the one the dates above name,
/// not the year the label is rendered in: an operation run in September would
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

/// `2026-09-19 16:00Z`. Written out rather than localized: these are the
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
      // Equality, because a state code is two characters: `WI` inside a longer
      // word would answer for Wisconsin in half the searches an operator types.
      || term === 'WI'
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

  /// Nothing to answer — the form is where the operator learns that the parks
  /// come from their POTA activation, which is the one thing about this event
  /// that is not obvious from its name.
  ///
  /// A `form`, because operation settings render `refList` and `form` and
  /// silently drop every other kind.
  ///
  /// The legacy type's control only on an operation that carries one: it is
  /// what the app finds for that row, and offered anywhere else it would be a
  /// second way to set up the same event under a name new operations no longer
  /// use.
  async operationControls(
    { operation }: { operation: Record<string, JSONValue> },
    ctx: HookContext,
  ): Promise<LoggingControlDescriptor[]> {
    const t = tFor(ctx)
    const text = [
      t('addPota'),
      `[${URL}](${URL})`,
      t('period', { period: `${fmtUtcDay(START_MILLIS)} — ${fmtUtcDay(END_MILLIS)}` }),
      t('scoring'),
      t('submit', { url: LOGS_URL }),
    ].join('\n\n')

    const types = refOfType(operation, LEGACY_TYPE) ? TYPES : [TYPE]
    return types.map((type) => ({
      key: `${type}/setup`,
      label: manifest.shortName,
      icon: manifest.icon,
      color: manifest.accentColor,
      order: 10,
      input: {
        kind: 'form',
        refType: type,
        form: { title: manifest.shortName, elements: [{ type: 'markdown', text }] },
      },
    }))
  },
}

const RefHandler = {
  /// Nothing to check: the ref's TYPE is the event, so a ref of this type is
  /// this event's whatever else it carries.
  async validateRef(_args: { ref: Ref }, _ctx: HookContext) {
    return { valid: true }
  },

  async decorateRef({ ref }: { ref: Ref }, _ctx: HookContext): Promise<Ref> {
    return { ...ref, program: 'Contest', label: LABEL, shortLabel: manifest.shortName, name: SUBTITLE }
  },

  /// "KI2D for WIPOTA". The park is POTA's to put in the title.
  async suggestOperationTitle(_args: { ref: Ref }, _ctx: HookContext): Promise<TitleSuggestion | null> {
    return { for: manifest.shortName }
  },

  async linkForRef(_args: { ref: Ref }, _ctx: HookContext): Promise<RefLink | null> {
    return { url: URL, label: NAME }
  },
}

const AdifFieldsHook = {
  async fieldsForOneQSO(
    { qso, operation }: { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> },
    _ctx: HookContext,
  ): Promise<{ name: string; value: string }[]> {
    if (!eventRefIn(operation)) return []
    return adifFieldsFor(manifest.shortName, qso, operation)
  },
}

const ADIF_EXPORT = `${TYPE}-adif`

function filenameFor(args: ExportOptionsRequest | ExportRequest): string {
  return exportFilename({
    stationCall: args.operation.stationCall,
    activity: manifest.shortName,
    startAtMillis: startMillisOf(args.operation, args.qsos ?? []),
    extension: 'adi',
    compact: args.compactFilenames,
  })
}

const ExportHook = {
  async getExportTypes() {
    return [exportTypeDefinition(TYPE, 'adif', manifest.shortName)]
  },

  /// ONE file for the whole operation, every park in it. The sponsor's form
  /// takes a single upload and lists the parks beside it, where POTA's own
  /// export is a file per park — and an entrant who is in no park at all, two
  /// of the sponsor's five classes, has no POTA export to send.
  async suggestExportOptions(args: ExportOptionsRequest, ctx: HookContext): Promise<ExportOption[]> {
    const ref = eventRefIn(args.operation)
    if (!ref) return []
    return [{
      exportType: ADIF_EXPORT,
      templateData: { activity: manifest.shortName },
      format: 'adif',
      label: tFor(ctx)('adifExport', { contest: manifest.shortName }),
      filename: filenameFor(args),
      selectedByDefault: true,
      // The type the operation ACTUALLY carries, so the file covers the
      // segments the contest ran in whichever name it was set up under.
      refType: String(ref.type),
    }]
  },

  async generateExport(args: ExportRequest, _ctx: HookContext): Promise<ExportResult> {
    // Only the exportType offered above: a hook answering for one it never
    // offered makes the ADIF delegation recurse.
    if (args.exportType !== ADIF_EXPORT) return { filename: '', mimeType: '', content: '' }

    const content = await adifForExport({
      operation: args.operation,
      qsos: args.qsos,
      segments: args.segments,
      includePrivateData: args.includePrivateData,
      includeLookupData: args.includeLookupData,
      exportSettings: args.exportSettings,
      exportData: args.exportData,
      exportTitle: args.exportTitle,
      // Ours alone. POTA's hook is deliberately NOT included — see adif.ts.
      mainHandler: manifest.key,
    })
    return { filename: filenameFor(args), mimeType: 'text/plain', content }
  },
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook('activity', { hook: ActivityHook, key: manifest.key })
    for (const type of TYPES) registerHook(`ref:${type}`, { hook: RefHandler, key: manifest.key })
    registerHook('adifFields', { hook: AdifFieldsHook, key: manifest.key })
    registerHook('export', { hook: ExportHook, key: manifest.key })
    // Both types, or an operation set up under the old one scores nothing while
    // its row sits there answered.
    registerHook('scoring', {
      hook: contestScorer(WipotaScorer, { scope: { refTypes: TYPES } }),
      key: manifest.key,
    })
  },
})
