# Ham2K Extensions

Official Ham2K Logger extensions that ship on their own, published to
[catalog.ham2k.net](https://catalog.ham2k.net) rather than bundled with the app.

An extension here is a standalone npm workspace: a manifest, some source, and
whatever shared library it leans on. It is built into a single bundle against
[`@ham2k/extension-sdk`](https://www.npmjs.com/package/@ham2k/extension-sdk),
uploaded to the catalog, and installed by operators who want it — so it ships,
and updates, without an app release.

Three kinds of thing live here. The **QSO parties**: the app carries one `qp`
extension holding all fifty, and this repository publishes them **one event per
extension**, so an operator installs the Texas QSO Party and gets the Texas QSO
Party. **Catalog copies of the app's own built-ins**, so that each can ship
and update without an app release — see **Porting a built-in**. And **two spotting
sources the app never shipped**, under the `ki2d-` callsign prefix a third
party's extension takes: the QSO Party Hub and APRS Tracker feeds that
app-polo's `qp` extension carried inside it, and an APRS position beacon.

## What is here

99 extensions, grouped by the manifest's own `category`:

| directory | manifest `category` | n | of which |
|---|---|--:|---|
| `extensions/activities/` | `activity` | 19 | 18 ported built-ins, 1 new program |
| `extensions/contests/` | `contest` | 68 | 14 ported built-ins, 49 QSO party events, 5 park events |
| `extensions/lookups/` | `lookup` | 5 | 5 ported built-ins |
| `extensions/spots/` | `spots` | 3 | 1 ported built-in, 2 new spotting sources |
| `extensions/dashboard/` | `dashboard` | 4 | 1 ported built-in, 3 SVG reference panels |
| **total** | | **99** | **39 ported, 57 new, 3 SVG reference panels** |

The 39 are the app's own extensions, ported one for one. The 57 are new: events
the app has never shipped separately, five state-park events, two spotting
sources, and one award program:

- **`ham2k-hota`** — [History on the Air](https://cqhota.app), historic sites
  over 200 years old, written for the catalog from cqhota.app's own
  [rules](https://cqhota.app/rules) and [API](https://cqhota.app/api-docs).
  Its ref types, `hota` and `hotaActivation`, are new, and are what a log
  holding a HOTA operation carries from here on: never rename them. Posting a
  spot takes the operator's own integration key from cqhota.app, entered as an
  account; the reference list and the spot feed need none.

- **The state-park events** — `ham2k-txspota`, `ham2k-flspota`,
  `ham2k-gaspota`, `ham2k-ohspota` and `ham2k-wispota` — are one extension
  each, written for the catalog from each sponsor's own rules rather than
  ported or generated. They share NO code, deliberately: each scorer follows
  its own sponsor and is free to diverge, and they already do — Texas adds its
  multipliers, Georgia scores hunters by a formula of their own, Ohio splits a
  multi-park operator into one entry per park. Each file cites the rules
  document and sections it implements; re-read those when a new season is
  published, and move the dates in `src/event.ts` (`src/index.ts` for
  Wisconsin) together with the manifest's `relevance.dates`.

  All five are played through POTA: the parks are the POTA refs already being
  logged, so only Ohio, whose sponsor exchanges a three-letter park identifier,
  has an entry-row field. Texas, Florida, Georgia and Ohio were one app
  built-in, `stateparks`, and an operation logged there carries
  `{type: 'stateparks', ref: 'TXSP'}`; each event claims its own with a
  qualified `ref:stateparks/<key>` and answers it as it stands, the way the QSO
  parties answer `ref:qp/<code>`. Wisconsin answers `wipota`, the type it
  stored under its first name, `ham2k-wipota`.

- **`ki2d-qso-party-spots`** reads the [QSO Party Hub](http://qsopartyhub.com)
  and the [QSO Party APRS Tracker](https://mobiletracker.stateqso.com) for
  every party running that weekend, and posts self-spots to the Hub. app-polo
  does both inside its `qp` extension; here neither can live in a per-event
  extension, because `fetchSpots` is handed no operation and fifty events each
  polling the feeds would be a hundred requests a cycle. It knows every party
  through `@ham2k/qso-parties/identities` — see **Layout**.
- **`ki2d-aprs-spotting`** turns a self-spot into an APRS-IS position beacon
  naming the frequency and what is being activated. During a QSO party the
  beacon carries the party's own token (`NEWE 14.250 MAWOR`), which is what
  the tracker parses and what app-polo sends; from a park it names the
  reference. One beacon source, deliberately: the QP source reads the tracker
  and never beacons, so the two installed together beacon once.

The SVG reference panels carry `ki2d-` keys and install from a file.
See [dashboard development](extensions/dashboard/README.md) for building and
packaging them; they require the experimental SVG host APIs.

## What is NOT here, and why

- **The 12 core extensions.** `adif`, `annotation-commands`, `dev-commands`,
  `lookups`, `operation-commands`, `radio-commands`, `scoring`,
  `settings-commands`, `spot-commands`, `templates`, `test-ops-commands` (the
  app's `extensions/core/`) and `ham2k-lofi` (its `extensions/sync/`). Each has
  **no `category` in its manifest**, and that is the whole definition: a
  category-less extension is core to the host — always enabled, invisible in the
  Extensions panel, loaded by the app itself. That is a status the app grants its
  own, and the packer refuses a bundle claiming it. These are infrastructure, not
  something an operator installs.
- **`qp`.** The app's single contest extension covering all fifty QSO parties.
  The 49 per-event extensions in `contests/` are its replacement, so porting it
  as well would offer the same fifty events twice.
- **`stateparks`.** The app's single extension for the Texas, Florida, Georgia
  and Ohio state-park events, for the same reason: the four per-event
  extensions in `contests/` replace it.

## What is published

**Every ported built-in is published**, and the app never runs one beside its
own copy. Every one declares the SAME `ref:` types as the copy the app carries —
`ref:pota`, `ref:sotaActivation`, `ref:cqww` — because those types name what is
written into an operator's log, and renaming one orphans every operation
already holding it. The kernel routes a ref type to exactly one handler, so
with both present the operator would get whichever the app picked: a coin toss
over their own log. What prevents that is the app's upgrade to catalog
extensions (its `docs/extensions/distribution.md`): once taken, the app offers
none of its built-ins but the core, and until it is taken a downloaded copy
stays on disk unused while the built-in it supersedes runs.

**The pre-loaded set** — `ham2k-pota`, `ham2k-sota`, `ham2k-wwff` and the five
lookups — the app also ships packaged, and installs on first run. Publishing
one means re-packing the copy in the app's `app/assets/preloaded-extensions/`
to match, so a new install starts on the current release.

The 49 QSO party events are published too. They are new events under their own
refTypes (`texas-qso-party`), not copies of anything the app ships — `qp`
stores `{ type: "qp", ref: "TX" }`, and an event reaches back for that pair with
a qualified `ref:qp/tx` claim rather than answering the bare type, so the two do
not collide on ref routing. An operator can see both offerings until `qp` is
retired.

**Channels say how finished a release is** — `stable`, `unstable`, `bleeding` —
and not which app edition is asking. They cascade: `stable` is visible to
everyone, `bleeding` only to somebody who went looking. Publishing without
saying publishes to `stable`.

## Layout

- `packages/*` — shared libraries several extensions use.
  - `@ham2k/lib-qso-party` — the QSO-party engine. One scorer, one exchange
    field, one Cabrillo writer and one setup form, built from the
    `QsoPartyParams` a party hands it. Every rule a sponsor can state is an
    option or a table there; nothing about a particular party lives in code.
    The form's own words are English unless an event supplies a translator for
    them — `labels` in `QsoPartyParams`, one function per label, taking the
    `ctx` the hook is handed. It is the same seam the manifest already gives
    the extension's name and description, reaching the setup form, the exchange
    row and the export sheet.
  - `@ham2k/lib-gma-spots` — cqgma.org's spot endpoint, which GMA and the
    castle, lighthouse, mill and tower awards built on its infrastructure all
    post through. A package rather than a file each of them copies, because
    eight copies of one endpoint's quirks diverge.
  - `@ham2k/qso-parties` — every party's rules, counties and dates as
    `QsoPartyParams`, one module per event, **generated** from the sponsors'
    own files. Edit a fixture and re-run the generator; never edit a module.
    Its `./identities` export is the slim view of all fifty — name, ref type,
    states, the APRS token and the tracker and hub pages, no counties — for
    the two spotting extensions that need every party at once, plus the two
    readers they share: which party an operation is in (its own ref type, or
    the bundled `qp` pair by longest prefix) and which counties its ref names.
  - `@ham2k/lib-vhf-contests` — what the IARU R1 and RSGB VHF+ contest
    extensions both need: the REG1TEST/EDI writer they submit, the grid half of
    the exchange they send, the ref readers they store it with, and the band
    multiplier they score by. Here because a published extension may not reach
    into another one's source and two copies of a scoring table diverge. The
    writer is contest-agnostic, the shape `@ham2k/lib-qson-cabrillo`'s is, so
    if the host ever carries it only the manifests change.
- `extensions/<category>/<key>` — one directory per published extension, grouped
  by the manifest's own `category`. The directory names a group and the manifest
  names one extension, so they differ by a plural: `activity` lives in
  `activities/`, `contest` in `contests/`, `lookup` in `lookups/`, and `spots`
  and `dashboard` name themselves. Those are the app's own source tree's
  spellings, so a built-in ported here lands in the directory it came from.
  `bundles.test.ts` holds each manifest to the directory it sits in.
- `extensions/bundles.test.ts` — builds, packs and loads every extension. It
  belongs to no workspace, so the root `npm test` names it directly.
- `scripts/convert-parties.mjs` — the party generator.
- `scripts/generate-event-extensions.mjs` — the event generator: one extension
  per party, from that party's own module. See **Adding an event**.
- `scripts/sdk-node-resolve.mjs` — makes the published SDK's `dist/` loadable by
  Node, so unit tests can import what the bundles import. See **The SDK gap**.

## Adding an extension

Three routes in, and which one you are on decides almost everything:

- a **QSO party event** — data only, generated. See **Adding an event**.
- a **port of one of the app's built-ins** — a procedure with traps in it. See
  **Porting a built-in**.
- **something new**, which is this section.

Every extension, whatever its category, is the same four files plus `src/`:

```
extensions/<category>/<key>/
  manifest.json     key, name, version 0.1.0, api 1, category, hooks,
                    sharedDependencies, and whatever the category needs
  package.json      private workspace, @ham2k/ext-<key>, build/typecheck/pack
                    (+ test, if it ships one)
  build.mjs         buildExtension(build, { dir: import.meta.dirname })
  tsconfig.json     extends ../../../tsconfig.base.json
  src/index.ts      defineExtension({ …, onActivation }) and its registerHook calls
```

Copy them from the nearest sibling rather than typing them; only `manifest.json`
and `src/` differ between two extensions in the same category. Three rules bind
everywhere, and `bundles.test.ts` enforces each:

- **The directory is the category and the key.** `activity` lives in
  `activities/`, `contest` in `contests/`, `lookup` in `lookups/`, and `spots`
  and `dashboard` name themselves; the directory's own name is the manifest
  `key`. The tree IS the categorisation, so nothing else would say a misfiled
  extension is misfiled.
- **`manifest.hooks` is what the code registers.** The panel and the catalog read
  that list without loading anything, so a hook promised and not registered is an
  extension the operator is told does something it does not. Plain categories
  match both ways; a `ref:` entry must be registered but need not be declared —
  see step 7 of **Porting a built-in** for why.
- **Every registration key is `manifest.key` or `` `${manifest.key}-…` ``**, and
  written as `manifest.key` rather than a literal so it cannot drift.

What each category actually is, with the worked example to read first:

| category | what it registers | read |
|---|---|---|
| `activity` | `activity` (from `referenceActivity`), `ref:<type>` per reference it publishes a control for, `export`/`adifFields` (`activityExportHook`, `huntingExportHook`), usually `dataFile`, `spots`, `scoring`, `adifImport` | `activities/ham2k-pota` |
| `contest` | `activity`, one `ref:<type>`, `scoring` (`contestScorer`), `export` + `adifFields` — Cabrillo through `@ham2k/lib-qson-cabrillo` | `contests/ham2k-cqww`, or `contests/ham2k-txqp` for a generated event |
| `lookup` | `lookup`, or `recentContextLookup` for one that only reads what the app already has; plus `account` for a service with a login, `dataFile` for one with a downloadable list, `settingsPanel`, `command`, `callNotes` | `lookups/ham2k-call-history` (one hook), `lookups/ham2k-qrz` (an account and a network service) |
| `spots` | `spots`, plus `account` where the service wants a login | `spots/ham2k-parksnpeaks` |
| `dashboard` | `panel` — a pane the operator adds to a dock, with per-pane config the host persists | `dashboard/ham2k-custom-text` |

Then: `npm install` (a new workspace has to reach the root lock), `npm test`,
`npm run typecheck`, `npm run build`, `npm run pack`. `sharedDependencies` is
determined by building — see step 11 of **Porting a built-in**, which is the same
procedure whether the code is ported or new.

## Adding an event

Everything specific to one QSO party is data. Adding one is:

1. Make sure `packages/qso-parties` has it — `src/parties/<code>.ts`, generated
   from `fixtures/<code>.json`. If the sponsor has published a new season, drop
   the updated files in and run `node scripts/convert-parties.mjs <dir>`; the
   diff is reviewable and the differential test says what changed.
2. `node scripts/generate-event-extensions.mjs` — it writes
   `extensions/contests/ham2k-<abbr>/` for every party that has no directory yet
   and leaves the ones that do alone (`--force` rewrites them). The abbreviation
   is the event's own, lowercased (`ham2k-txqp`), and is also the manifest `key`
   and the directory name. Every event differs from every other only in identity
   and in which party it imports, so all four files are **derived from the
   party's own module** rather than typed: the key from its short name, the
   description and the keywords from its states, the icon and the `relevance`
   ranking from its entity, its `relevance.dates` from the same `periods` the
   scorer runs on, and `hooks` from the refType it states. A sponsor's re-sync
   therefore reaches the extensions by re-running this, and an event edited by
   hand is one the next run reverts. Two rules worth knowing before reading a
   surprising key:
   - a party whose fixture says `disabled` gets no extension — nobody has
     verified its rules against a sponsor, and an extension built from one would
     score an operator's log by guesses (`NSARA`, whose sponsor's page is gone);
   - two parties can share an abbreviation — Nebraska and New England are both
     `NEQP` — and then BOTH fall back to their party code, `ham2k-ne` and
     `ham2k-neqp`. Both, rather than first-come, so that which one keeps the
     abbreviation never depends on the order the parties are walked in, and
     adding a third never renames an existing one.

   The four files it writes:
   - `manifest.json` — key, name, `shortName`, version, description,
     `category: "contest"`, `api: 1`, icon, accent, keywords, `hooks`,
     `relevance`,
     `sharedDependencies`, and any `translations`. `name` is
     `ABBR: Full Name` (`TXQP: Texas QSO Party`); `shortName` is the
     abbreviation alone. The app searches an extension by its `name`,
     `description` and `keywords` and **never** by its `shortName`, so the
     abbreviation belongs in the name for an operator to type; everywhere
     narrow — the export sheet, the scoreboard heading, an import notice —
     reads `shortName`, so the two never appear together.
     **`hooks` must list exactly what the code registers, `ref:<refType>`
     included** — the panel and the catalog read that list without loading
     anything, and `bundles.test.ts` holds the two to each other.
   - `package.json` — a private workspace with `build`, `typecheck` and `pack`.
   - `build.mjs` — `buildExtension(build, { dir: import.meta.dirname })`.
   - `src/index.ts` — `defineQsoParty({ ...PARTY, extensionKey: manifest.key, … })`
     and five `registerHook` calls, each under that same `manifest.key`: the
     party's own ADIF export reaches its `adifFields` hook by the key it is
     given here.
3. `npm install` (a new workspace has to reach the root lock), then `npm test`.

**The key and the refType are two namespaces, and they do not match.** The key
names the package — `ham2k-txqp`, short because it is a catalog identifier and
a file name. The refType names the activation an operator's operation stores —
`texas-qso-party`, descriptive because a log carries it and has to stay
readable years after the package was named. Renaming one never renames the
other: a key is free to change with a new catalog entry, a refType is not,
because the operations already holding it would stop finding their extension.

The `icon` is **per event**, and the two here are only defaults: `star-box` for
a QSO party, `leaf-maple` for a Canadian one. They live in the manifest so that
any event can be given its own without touching the engine or its party data —
which is where a sponsor's own glyph would go. The engine falls back to
`star-box` for a party whose manifest names none. Both are
[MDI](https://pictogrammers.com/library/mdi/) names, and the app renders only
what its codepoint table carries, so check a new one against
`packages/halo_widgets/lib/src/icon_codepoints.g.dart` before using it.

`relevance` is worth a moment. It **ranks** an extension in the catalog and in
the Extensions panel; nothing is hidden by it. Every event declares both
countries, its own first — `{"countries": ["us", "ca"]}` for a US party —
rather than `{"entities": ["K", "VE"]}`, because the DXCC entity `K` is the
lower 48: Alaska is `KL` and Hawaii is `KH6`, and an operator in either is a
prime multiplier in every one of these events rather than someone to rank it
away from. The ISO country the app derives for `KL` and `KH6` is `us`, so
`countries` says what was meant. Canada is in the list because Canadian
stations work the US parties and the other way round.

Alongside the countries it carries `dates`: the UTC days the party's sessions
begin, `YYYY-MM-DD`, taken from the same `periods` the scorer runs on. Reading
them off the fixture rather than keeping a second copy is what stops the
catalog advertising a weekend the extension does not score. Re-run
`node scripts/generate-event-extensions.mjs --manifests` after a fixture
re-sync and every date moves at once, touching nobody's hand-written prose.

## Porting a built-in

The app ships 53 extensions of its own. 39 of them are here, ported one for one,
so that each can ship and update without an app release; the other 14 are the 12
core ones, `qp` and `stateparks`, and **What is NOT here** says why none of them
comes across.
`extensions/activities/ham2k-pota` is the worked example; every step below is
one it went through. All 39 are published — see **What is published** for why
that never puts two handlers on one ref type.

1. **Copy.** `src/**` (tests included), `manifest.json`, and the `src/i18n/*.json`
   catalogs, into `extensions/<category>/ham2k-<key>/`. Nothing else: the app's
   build lists its extensions in `build-config.mjs`, and here each one carries its
   own `build.mjs`.
2. **Relicense.** Every ported file's header becomes
   `// SPDX-License-Identifier: MIT`. The app is MPL-2.0 and this repository is
   deliberately the looser of the two; a file takes the licence of the tree it is
   in, not the one it arrived with.
3. **Add the three workspace files**, copied from an existing extension:
   `package.json` (private, `build`/`test`/`typecheck`/`pack`), `build.mjs`
   (`buildExtension(build, { dir: import.meta.dirname })`), and `tsconfig.json`
   (`extends: "../../../tsconfig.base.json"`).
4. **The key becomes `ham2k-<original key>`** — `pota` → `ham2k-pota` — and the
   directory is named for it.
5. **`name` gains the `ABBR: Full Name` form, but only where the abbreviation is
   one an operator actually says.** POTA, SOTA and WWFF are how their operators
   name those programs, so `POTA: Parks on the Air`. `custom`, `satellites` and
   `simple-contest` have no such abbreviation, and inventing one to fill the
   pattern would put a string in the search index that nobody will ever type. The
   test is whether `shortName` already holds a word an operator uses on the air —
   not whether the name can be abbreviated.
6. **`api: 1` and `version: 0.1.0`** on every ported manifest. The app's own
   manifests carry neither (`api` is the distribution format's, and a built-in
   version means nothing), and the packer refuses a manifest with no `api`.
7. **`refType`s and every `ref:` hook stay EXACTLY as they are.** `ref:pota`,
   `ref:potaActivation`. They name what is written into an operator's log, and a
   renamed one orphans every operation already holding it — silently, because the
   operation still shows the reference and nothing answers for it any more. The
   same goes for everything else the log or the local database already carries:
   spot `source` values, `dbLookupSelect*` categories, logging-control keys like
   `pota/hunter`. Rename the package; never rename the data.

   **`referenceActivity({ key })` is one of those**, and it does not look like
   it. That `key` is not a registration key: the SDK builds the logging-control
   keys (`wca/activation`, `wca/hunter`) and the `dbLookup` category out of it,
   which is also what the extension's own `DataFileDefinition.category` has to
   equal. It stays the app's key while every `registerHook` around it moves.
8. **Registration keys move into the new key's namespace.** Every
   `registerHook(..., { key })` becomes `manifest.key`, written as `manifest.key`
   rather than a literal so it cannot drift. A registration that deliberately used
   a sub-key keeps the relationship: `pota-all-parks` → `` `${manifest.key}-all-parks` ``,
   `pota-hunter` → `` `${manifest.key}-hunter` ``. The hook rules that take a
   `key` of their own — `activityExportHook`, `huntingExportHook` — take
   `manifest.key` too: that field is `mainHandler`, and the exporter looks up the
   `adifFields` hook registered under it.
9. **A key that names ANOTHER extension becomes that extension's ported key.**
   POTA's `includeFieldsFrom: ['satellites']` becomes `['ham2k-satellites']`. The
   ported set is self-consistent; an unmatched key contributes nothing and says
   nothing.
10. **Resolve the imports that reach out of the extension.** Three kinds:
    - **A shared library the host carries** (`@ham2k/lib-dxcc-data`,
      `@ham2k/lib-geo-tools`, `i18next`, …) — leave the import alone and declare
      it in `sharedDependencies`; see below.
    - **The SDK's own source**, which built-ins reach by relative path
      (`../../../sdk/src/dxcc.ts`) — becomes the bare `@ham2k/extension-sdk`,
      whose published barrel exports it. See **The SDK gap** for the symbols it
      does not.
    - **Another extension's source** (`rsgb-vhf-tests` reaching into
      `r1-vhf-tests`; the contests that took `qsonToCabrillo` from
      `simple-contest`) — never a relative path across two published packages.
      If the app has since moved it to a real npm package
      (`@ham2k/lib-qson-cabrillo`), import that. Otherwise it becomes a workspace
      under `packages/`, imported by both — which is what `@ham2k/lib-qso-party`
      already is. Copying it into each extension is the last resort and needs
      saying out loud, because two copies of a scoring rule diverge.
11. **Declare `sharedDependencies` for real.** The app injects all twelve at `*`
    for its built-ins — correct there, because a built-in ships inside the very
    app that holds them — and the catalog refuses `*`, because a range is the only
    thing the host can check before it loads a bundle. Determine yours by
    building: the preset ERRORS on any host library the bundle reaches and the
    manifest does not declare, naming it. Start from the majors
    (`^1.0.0`, `i18next: ^23.0.0`, `liquidjs: ^10.0.0`) and raise a floor only
    where a specific release added something you call — `@ham2k/lib-qson-cabrillo`
    is `^1.2.0` because 1.2.0 added the Cabrillo *writer*. Then confirm nothing
    unused is left over:
    `grep -o '__polo\.sharedModules\["[^"]*"\]' build/index.js | sort -u`.
    POTA's eight are what the SDK barrel itself reaches; it declares no
    `@ham2k/lib-qson-cabrillo`, `-qson-adif`, `-qson-tools` or `-cqmag-data`
    because nothing on its path touches them.
12. **`relevance` only where it is truthfully narrow.** It ranks an extension
    and hides nothing, so a wrong one is merely useless while a missing one
    costs nothing. Most built-ins have none and keep none: POTA, SOTA and WWFF
    are worldwide programs. Declare the geographic keys where the extension is
    genuinely about one place — a national activity award, a regional QSO party
    — and prefer `countries` to `entities`, for the reason above. `dates` where
    the extension already knows when its events run, and nowhere else: a date
    typed from memory goes stale in a way nothing here can catch.
    `interests` only where the extension is DEDICATED to one — `cw` for the
    CWTs, `vhf uhf microwave` for the VHF families, `satellite` for the
    satellite tracker. A contest that merely permits CW is not a `cw`
    extension, and tagging it makes every interest match everything.
13. **`npm install`** (a new workspace has to reach the root lock), then
    `npm test`, `npm run typecheck`, `npm run build`, `npm run pack`.

## Export settings

Exporting extensions use SDK 0.4.0. Every export hook registers shared settings
through `getExportTypes()`: `exportType` identifies the activity and format,
while `exportKey` identifies an individual file, such as a park in an activation.
Catalog copies share types with their bundled counterparts. Each QSO-party
event registers its own ref type, with Cabrillo only when its sponsor names one.
ADIF delegation forwards data preferences and templates to the host generator.
Reference activity helpers select reference defaults; other exports select
other-activity defaults. Sponsor-specific filename patterns remain editable defaults.

## The SDK gap

The app's extensions build against the SDK's **source**; these build against the
**published** `@ham2k/extension-sdk`, and the two are not the same surface.

- **A symbol the published SDK does not export yet** goes into the extension's
  own `src/sdkGap.ts`, copied verbatim from the SDK with a comment saying what it
  is a copy of, and is deleted the day the SDK publishes it — 0.3.0 emptied every
  runtime copy there was. The one standing debt is the hook-test harness —
  `loadExtension`, `fixtureOperation`, `fixtureQso` — in `src/sdkGapTesting.ts`
  wherever an extension has hook tests: the SDK holds it in `src/testing.ts` and
  keeps it out of the barrel deliberately, so every extension does not bundle
  it, and publishes no `./testing` subpath to import it by instead. A test-only
  copy gets its own file so that a runtime copy in `sdkGap.ts` never drags it
  into the bundle. Grep for `sdkGap` to find every such debt at once.
- **The published `dist/` is bundler-only**: its barrel re-exports `./types` with
  no file extension and its catalogs import `.json` with no import attribute.
  esbuild resolves both, which is why every bundle builds; Node resolves neither,
  and refuses the package at `ERR_MODULE_NOT_FOUND .../dist/types`. So a unit test
  that reaches the SDK needs `--import ../../../scripts/sdk-node-resolve.mjs`,
  which is what each extension's `test` script passes. Delete that file, and the
  flag, the day the SDK publishes a Node-resolvable dist.

## Building and packing

Node 24, ESM, TypeScript.

```sh
npm install
npm test                       # every workspace, then every bundle
npm test -w @ham2k/lib-qso-party
npm run typecheck              # the whole tree
npm run build                  # bundles each extension into its build/
npm run pack                   # builds, then writes each <key>-<version>.h2kext
```

`npm test` runs `node --experimental-strip-types --test`, which strips the
types and runs the `.ts` files as they are. Imports therefore name the `.ts`
file they mean — `./params.ts`, not `./params.js`.

`npm run pack` passes `--force-name`, which is what a `ham2k-` key needs; see
below.

## Bundle sizes, and why they are what they are

Built as they are today, unminified, through the same preset the app's own
extensions use. The last column is what the app ships those same extensions as,
in `app/assets/extensions/*.js`:

| category | n | `index.js` | `.h2kext` | the app's own |
|---|--:|---:|---:|---:|
| `activities/` | 18 | 1,441,156 | 406,947 | 1,453,460 |
| `contests/` — the 15 ported | 15 | 1,450,815 | 405,193 | 1,465,716 |
| `lookups/` | 5 | 131,102 | 40,358 | 122,474 |
| `spots/` | 1 | 33,018 | 10,181 | 31,495 |
| `dashboard/` | 1 | 24,345 | 7,613 | 23,064 |
| **the 40 ported built-ins** | **40** | **3,080,436** | **870,292** | **3,096,209** |
| `contests/` — the 49 events | 49 | 6,679,336 | 1,810,516 | `qp.js`: 318,412 |
| **everything here** | **89** | **9,759,772** | **2,680,808** | **3,414,621** |

**A ported built-in costs what the app's own copy costs — 0.5% LESS in
aggregate.** The app does not share one SDK across its extensions either: it
bundles each into its own asset file, and every one of those already carries its
own SDK slice. So the standalone form is not the expensive form, and the 40
ported bundles land within a couple of kilobytes of their originals each way
(the big activity and contest bundles run ~850 bytes smaller, the small lookup
ones ~1.5 KB larger — the published SDK 0.2.0 against the app's SDK source).

**All of the growth is the QSO parties: 6,679,336 bytes for 49 events against
318,412 for the app's single `qp.js`, 21× for the same fifty events.** That is
not the porting; it is one bundle per event where the app has one bundle for all
of them. Texas breaks down as:

| | bytes |
|---|---:|
| `@ham2k/extension-sdk` | 66,026 |
| `@ham2k/lib-qso-party` — the engine | 59,097 |
| the party itself — 254 counties, its options and its dates | 6,004 |
| this extension's own code | 3,745 |
| esbuild's runtime and its IIFE wrapper | 4,341 |
| **`ham2k-txqp/build/index.js`** | **139,213** |

**The event is 4% of its own bundle** — which is why New York, with 62 counties
against Texas's 254, is only 3,733 bytes smaller. The other 96% is code every
party's bundle carries an identical copy of, because the app is untouched by
this work: the host offers a fixed list of shared libraries, the engine is not
on that list, so each bundle brings its own. Making `@ham2k/lib-qso-party` a
host shared module — the same mechanism `@ham2k/lib-qson-cabrillo` and the rest
already go through — takes each of these to roughly ten kilobytes, and is what
makes fifty separate extensions cheaper than one extension holding fifty
parties. Until then, an operator who installs four pays for four engines — and
the catalog holding all 49 carries the engine and the SDK 49 times, which is
what the 6.7 MB above almost entirely is.

The same arithmetic reaches the ported 40, and is worth knowing before anyone
reads their near-parity as "no problem here". They are not the same size as the
app's copies because they share something; they are the same size because they
duplicate exactly what the app's copies already duplicate. Each bundle carries
its own tree-shaken slice of the SDK — 66 KB in an event, which pulls the
scorers and the export machinery, down to a couple of kilobytes in
`ham2k-spot-history`, whose whole bundle is 14,894 bytes. Nothing here makes
that worse and nothing here makes it better. Publishing `@ham2k/extension-sdk`
as a host shared module, the way `@ham2k/lib-qson-cabrillo` already is, is the
one change that moves every number on this page.

## The `ham2k-` prefix, and what it means for testing

These keys are Ham2K's own, and the app treats them differently from anyone
else's:

- **The packer refuses a `ham2k-` key** unless given `--force-name`. Each
  extension's `pack` script passes it; that is the only reason these package at
  all.
- **The app refuses a `ham2k-` key on install** — with one waiver, and it is
  narrow. A bundle that arrived from `catalog.ham2k.net`, over bytes that
  hashed to the sha256 the listing gave, is recorded as having come from there,
  and the prefix rule is waived on every read for that key. Uninstalling it, or
  installing the same key from a file, clears the record and the waiver with
  it. A key the app itself ships stays refused whatever the catalog says.

So **these bundles cannot be side-loaded for hand testing as they are.**
Installing one from a file, or from a deep link naming any host but the
catalog, is refused before the zip is opened. Trying one on a device means
publishing it to the catalog, or building it under a key that is not `ham2k-`.

## Open, and load-bearing

**The host must carry `@ham2k/lib-qson-cabrillo` 1.2.0 or newer.** That release
added the Cabrillo *writer* the engine calls; 1.1.0 and earlier read Cabrillo
and cannot write it. 61 of the 64 contests and events declare `^1.2.0` — all but
the two VHF families, which submit REG1TEST/EDI instead, and Winter Field Day,
which has no Cabrillo submission. The host checks a declared
range against the copy it actually holds, so an app built against an older one
refuses those bundles by name and version rather than failing at the moment
someone exports a log. The app's own `extensions/package.json` is where that
floor is raised.

## License

MIT — see [LICENSE.md](LICENSE.md). The app and the SDK are MPL-2.0; this repo
is deliberately the looser of the two, so that an event's own club can take
what is here and publish under its own name without inheriting a copyleft
obligation from us.
