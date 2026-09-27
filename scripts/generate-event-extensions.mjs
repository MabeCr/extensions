// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Writes one extension per QSO party, from that party's own module —
// `packages/qso-parties/src/parties/<code>.ts` in,
// `extensions/contests/ham2k-<abbr>/` out.
//
// Usage:
//   node scripts/generate-event-extensions.mjs             write the missing ones
//   node scripts/generate-event-extensions.mjs --force     rewrite every one
//   node scripts/generate-event-extensions.mjs --manifests rewrite only the
//       manifests of the extensions that already exist. The yearly re-sync:
//       `relevance.dates` moves with every sponsor's calendar, and nothing
//       else in an extension does — so this is the run that does not touch a
//       line of anyone's hand-written prose.
//
// Fifty events differ from each other only in identity and in which party they
// import, so every field that is not boilerplate is DERIVED here rather than
// typed fifty times: the key from the party's short name, the description and
// the keywords from its state list, the icon and the `relevance` ranking from
// its entity, and `hooks` from the refType the party states and the five
// registrations the template makes. A sponsor's re-sync therefore reaches the
// extensions by re-running this, and an extension edited by hand is one the
// next run silently reverts — which is why an existing directory is skipped
// unless `--force` says otherwise.
//
// The four events that predate this script (7QP, CPQP, NYQP, TXQP) are
// hand-written and carry per-party prose in `src/index.ts`; `--force` replaces
// that prose with this template's. Nothing else about them changes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { PARTIES } from "@ham2k/qso-parties"
// The engine's own table, read directly rather than copied: an extension's
// description names a state and the scorer's summary names the same one, so a
// second spelling here would be a second answer to one question.
import { CANADIAN_PROVINCES, US_STATES } from "../packages/lib-qso-party/src/locations.ts"

const EXTENSIONS_DIR = resolve(import.meta.dirname, "..", "extensions", "contests")

const VERSION = "0.2.18"

/// The accent an event carries, by the flag of the country whose party it is.
/// Two colors for the family rather than fifty — what tells two events apart
/// in the panel is their name and their icon — and which of the two is the one
/// thing an operator scanning the list already knows about a party.
///
/// The blue people picture on the flag rather than the one on the cloth: the
/// official Old Glory Blue is a near-black navy, and at the size of an icon
/// tile it reads as an absence of color rather than as blue. The red is
/// matched to it in weight so neither country's rows shout over the other's.
///
/// Both are dark enough for the white glyph the app and the catalog site draw
/// on them; a lighter flag color would need a second foreground.
const ACCENT_COLORS = { us: "#1F4FA0", ca: "#D80621" }

/// The party's own `legacyRefs` as manifest `hooks` entries.
///
/// Read from the party data rather than re-derived here: the engine matches on
/// that list and the control publishes it, so a second derivation would be a
/// third answer to the question of which references this party handles — and
/// the one that decides what is OFFERED, which is the one that must not drift.
function legacyRefHooks(party) {
  return (party.legacyRefs ?? []).map((claim) => `ref:${claim.type}/${claim.prefix}`)
}

/// A party whose data says do not ship it. `disabled` is the sponsors' own
/// files' flag, carried through the fixtures, and it means nobody has verified
/// the rules against a sponsor — an extension built from one would score an
/// operator's log by guesses.
const DISABLED_REFTYPES = new Set(["nsara"])

/// The libraries the built bundle reaches on the host. Identical for every
/// event, because every event's code is this script's one template; the build
/// preset errors by name on an undeclared one and `bundles.test.ts` holds the
/// declaration to what the bundle actually looks up.
const SHARED_DEPENDENCIES = {
  "@ham2k/lib-callsigns": "^1.0.0",
  "@ham2k/lib-country-files": "^1.0.0",
  "@ham2k/lib-dxcc-data": "^1.0.0",
  "@ham2k/lib-format-tools": "^1.0.0",
  "@ham2k/lib-geo-tools": "^1.0.0",
  "@ham2k/lib-operation-data": "^1.0.0",
  "@ham2k/lib-qson-cabrillo": "^1.2.0",
  "i18next": "^23.0.0",
  "liquidjs": "^10.0.0",
}

/// Spanish for each state and province, for the translated description and
/// keywords. Not in `locations.ts`: the engine prints a location in the words
/// the sponsor's rules use, and these are the words an operator SEARCHES in.
/// A place with no entry here stops the run rather than reaching a manifest
/// untranslated.
const PLACES_ES = {
  AK: "Alaska",
  AL: "Alabama",
  AR: "Arkansas",
  AZ: "Arizona",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawái",
  IA: "Iowa",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Luisiana",
  MA: "Massachusetts",
  MD: "Maryland",
  ME: "Maine",
  MI: "Míchigan",
  MN: "Minnesota",
  MO: "Misuri",
  MS: "Misisipi",
  MT: "Montana",
  NC: "Carolina del Norte",
  ND: "Dakota del Norte",
  NE: "Nebraska",
  NH: "Nuevo Hampshire",
  NJ: "Nueva Jersey",
  NM: "Nuevo México",
  NV: "Nevada",
  NY: "Nueva York",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregón",
  PA: "Pensilvania",
  RI: "Rhode Island",
  SC: "Carolina del Sur",
  SD: "Dakota del Sur",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VA: "Virginia",
  VT: "Vermont",
  WA: "Washington",
  WI: "Wisconsin",
  WV: "Virginia Occidental",
  WY: "Wyoming",
  AB: "Alberta",
  BC: "Columbia Británica",
  MB: "Manitoba",
  NB: "Nuevo Brunswick",
  NL: "Terranova y Labrador",
  NS: "Nueva Escocia",
  NT: "Territorios del Noroeste",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Isla del Príncipe Eduardo",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukón",
}

/// What a MULTI-state party is called in Spanish when no one state names it.
/// The English keywords list its states; one Spanish word for the region is
/// what an operator would type instead, and there is nothing in the party data
/// to derive it from. A multi-state party missing here stops the run.
const REGIONS_ES = {
  "7qp": "oeste",
  "ac-qso-party": "canadá",
  "cp-qso-party": "canadá",
  "neqp": "nueva inglaterra",
}

/// A sponsor's own word for its counties, keyed by the plural the party
/// declares (`labelForCounties`): the singular an operator would search for,
/// and both in Spanish. The engine's default is `Counties`; a party that
/// renames them (`Districts`) is found by its own noun in both languages, or
/// the keywords search for the wrong one. Spelled out rather than derived,
/// because English plurals are not one rule — `counties`, `districts`,
/// `parishes`.
const NOUNS = {
  counties: { singular: "county", es: ["condado", "condados"] },
  districts: { singular: "district", es: ["distrito", "distritos"] },
  parishes: { singular: "parish", es: ["parroquia", "parroquias"] },
}

function placeName(code) {
  const name = US_STATES[code] ?? CANADIAN_PROVINCES[code]
  if (!name) throw new Error(`no name for the state or province '${code}'`)
  return name
}

function placeNameEs(code) {
  const name = PLACES_ES[code]
  if (!name) throw new Error(`no Spanish name for the state or province '${code}' — add it to PLACES_ES`)
  return name
}

/// `A, B and C`. The final conjunction rather than a bare comma list, because
/// this reads as a sentence in the panel.
function joinList(items, conjunction) {
  if (items.length <= 1) return items[0] ?? ""
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`
}

/// The catalog key, and so the directory name and the manifest key.
///
/// The abbreviation an operator says on the air, which two parties can share:
/// Nebraska and New England are both `NEQP`. A shared abbreviation cannot be a
/// key, so BOTH fall back to the party's own module code — both, rather than
/// first-come, so that which one wins never depends on the order this map is
/// walked in, and adding a third party never renames an existing one.
function keysByCode(parties) {
  const counts = {}
  for (const party of Object.values(parties)) {
    const abbr = party.short.toLowerCase()
    counts[abbr] = (counts[abbr] ?? 0) + 1
  }

  const keys = {}
  const collisions = []
  for (const [code, party] of Object.entries(parties)) {
    const abbr = party.short.toLowerCase()
    if (counts[abbr] > 1) {
      keys[code] = `ham2k-${code.toLowerCase()}`
      collisions.push({ code, abbr, key: keys[code], name: party.name })
    } else {
      keys[code] = `ham2k-${abbr}`
    }
  }
  return { keys, collisions }
}

/// The UTC days [party]'s sessions begin, `YYYY-MM-DD`, in order and without
/// repeats — the manifest's `relevance.dates`.
///
/// A party that runs two sessions on one day contributes that day once; one
/// that runs a session on each of two days contributes both, because both are
/// days an operator would want to know about. A period running past midnight
/// UTC still counts only as the day it STARTED: the manifest says when things
/// begin, and the bundle is the only thing that knows when they end.
function startDaysOf(party) {
  const days = (party.periods ?? []).map((period) => new Date(period.startMillis).toISOString().slice(0, 10))
  return [...new Set(days)].sort()
}

function manifestFor(code, key, party) {
  const isCanadian = party.entity === "VE"
  const states = party.state ? [party.state] : party.states
  if (!states?.length) throw new Error(`${code} names neither a state nor a list of them`)

  const plural = (party.labelForCounties ?? "Counties").toLowerCase()
  const noun = NOUNS[plural]
  if (!noun) throw new Error(`no nouns for '${plural}' — add it to NOUNS`)
  const singular = noun.singular
  const nounsEs = noun.es

  // What KIND of party it is, in the words an operator would search: a party
  // spanning several US states is regional; anything Canadian is provincial,
  // one province or three.
  const kind = isCanadian ? "provincial qso party" : party.state ? "state qso party" : "regional qso party"

  const keywords = [
    "contest",
    "qso party",
    kind,
    singular,
    plural,
    "cabrillo",
    ...(party.state ? [party.state.toLowerCase()] : []),
    party.short.toLowerCase(),
    ...(party.state ? [placeName(party.state).toLowerCase()] : []),
    party.name.toLowerCase(),
    ...(party.state ? [] : states.map((state) => placeName(state).toLowerCase())),
  ]

  const startDays = startDaysOf(party)

  const regionEs = party.state ? placeNameEs(party.state).toLowerCase() : REGIONS_ES[party.refType]
  if (!regionEs) throw new Error(`no Spanish region keyword for ${party.refType} — add it to REGIONS_ES`)

  return {
    key,
    // A contest is known by its full name; the abbreviation is what a search
    // finds it by, which is why the keywords carry it.
    name: party.name,
    shortName: party.short,
    version: VERSION,
    description: party.state
      ? `Work stations in ${placeName(party.state)}.`
      : `Work stations in ${joinList(states, "and")}.`,
    category: "contest",
    // `leaf-maple` for a Canadian party, `star-box` for the rest — the engine's
    // own fallback, stated here so an event can be given a sponsor's glyph
    // without touching the engine.
    icon: isCanadian ? "leaf-maple" : "star-box",
    accentColor: isCanadian ? ACCENT_COLORS.ca : ACCENT_COLORS.us,
    api: 1,
    keywords: [...new Set(keywords)],
    // Exactly what `src/index.ts` registers, `ref:` included: the panel and the
    // catalog read this list without loading the bundle.
    //
    // The qualified entry is how an operation logged when fifty parties were
    // one extension reaches this one. `ref:qp/tx` claims the `qp` references
    // whose code begins `tx`, which is the pair the bundled extension wrote —
    // and claims it more precisely than the bundled extension's own `ref:qp`,
    // so this party wins the offer without either knowing the other exists.
    // Nothing is rewritten: the claim is a promise to answer for the old
    // shape, not to change it.
    hooks: ["activity", "adifFields", "export", `ref:${party.refType}`, ...legacyRefHooks(party), "scoring"].sort(),
    // A ranking, not a filter. Both countries either way: Canadian stations work
    // the US parties and the other way round, and the party's own country goes
    // first. `countries`, not `entities`, because the DXCC entity `K` is the
    // lower 48 — Alaska is `KL` and Hawaii `KH6`, and both derive `us`.
    //
    // `dates` comes off the same `periods` the scorer runs on, so a re-synced
    // fixture moves the listing and the scoring together. A hand-kept copy
    // would let the catalog advertise a weekend the extension does not score.
    relevance: {
      countries: isCanadian ? ["ca", "us"] : ["us", "ca"],
      // Omitted rather than emptied for a fixture with no periods: an empty
      // list and an absent one mean the same thing, and only one of them
      // reads as an author who forgot.
      ...(startDays.length ? { dates: startDays } : {}),
    },
    sharedDependencies: SHARED_DEPENDENCIES,
    translations: {
      es: {
        description: party.state
          ? `Trabaja estaciones en ${placeNameEs(party.state)}.`
          : `Trabaja estaciones en ${joinList(states, "y")}.`,
        keywords: ["concurso", nounsEs[0], nounsEs[1], regionEs],
      },
    },
  }
}

function packageJsonFor(key, party) {
  return {
    name: `@ham2k/ext-${key.replace(/^ham2k-/, "")}`,
    version: VERSION,
    private: true,
    description: `Ham2K Logger extension: the ${party.name}`,
    author: "Sebastian Delmont <sd@ham2k.com>",
    license: "MIT",
    type: "module",
    scripts: {
      build: "node build.mjs",
      typecheck: "tsc --noEmit",
      pack: "npm run build && h2kext-pack build --force-name",
    },
    dependencies: {
      "@ham2k/lib-qso-party": "^0.1.0",
      "@ham2k/qso-parties": "^0.1.0",
    },
    devDependencies: {
      "@ham2k/extension-sdk": "^0.9.0",
      "@ham2k/extension-tools": "^0.7.0",
      esbuild: "^0.25.5",
    },
    engines: { node: ">=24" },
  }
}

const TSCONFIG = `{
  "extends": "../../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
`

const BUILD_MJS = `// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Builds this extension the way any third party builds one: esbuild is ours to
// bring, the preset carries the settings the sandbox requires, and everything
// \`manifest.json\` declares under \`sharedDependencies\` becomes a lookup on the
// host's single copy rather than a second copy in the bundle.
//
//   node build.mjs && npx h2kext-pack build --force-name
//
// \`--force-name\` is what a \`ham2k-\` key needs — see the repository README.

import { build } from 'esbuild'
import { buildExtension } from '@ham2k/extension-tools'

const { outDir } = await buildExtension(build, { dir: import.meta.dirname })

console.log('built', outDir)
`

function indexTsFor(code, party) {
  return `// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The ${party.name}.
//
// Every rule this extension applies is \`@ham2k/lib-qso-party\`'s and every fact
// about the event is \`@ham2k/qso-parties\`'; this file is only where the two meet
// the host. So an event with options, a points table and bonus stations is
// exactly as long as one with none: what differs between two QSO parties is
// DATA, and a rule that is not in the party file is a rule this extension does
// not apply.
//
// GENERATED — \`node scripts/generate-event-extensions.mjs\` writes this file and
// the manifest beside it from \`packages/qso-parties\`. Edit the party's fixture
// and re-run; an edit here is lost on the next re-sync.

import { defineExtension } from "@ham2k/extension-sdk"
import { defineQsoParty } from "@ham2k/lib-qso-party"
import { PARTY } from "@ham2k/qso-parties/${code.toLowerCase()}"

import manifest from "../manifest.json" with { type: "json" }

// The key, the icon and the accent are the EXTENSION's, not the sponsor's
// rules: the party data is generated from the sponsor's own file and carries
// none of them. The key has to be the one every hook below registers under —
// the party's own ADIF export reaches its \`adifFields\` hook by it.
const hooks = defineQsoParty({ ...PARTY, extensionKey: manifest.key, icon: manifest.icon, accentColor: manifest.accentColor })

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook("activity", { hook: hooks.activity, key: manifest.key })
    // The ref TYPE names the party and deliberately does NOT follow the
    // compact key: the key identifies the package in the catalog, the refType
    // identifies the activation stored in an operator's operation, which a
    // renamed package still has to answer for. This extension is the only
    // thing that answers for it, and \`manifest.hooks\` has to say the same, or
    // the app is told about a hook nobody registered.
    registerHook(\`ref:\${hooks.refType}\`, { hook: hooks.refHandler, key: manifest.key })
    // The same handler under the legacy pairs this party answers for. The
    // kernel resolves a \`ref:qp\` call against these by the reference's own
    // code, longest prefix first, so the party that named the reference
    // answers it and the one that claimed the family does not.
    for (const claim of PARTY.legacyRefs ?? []) {
      registerHook(\`ref:\${claim.type}/\${claim.prefix}\`, { hook: hooks.refHandler, key: manifest.key })
    }
    registerHook("adifFields", { hook: hooks.adifFields, key: manifest.key })
    registerHook("export", { hook: hooks.export, key: manifest.key })
    registerHook("scoring", { hook: hooks.scoring, key: manifest.key })
  },
})
`
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

/// Sets an existing package.json's `version` to VERSION, leaving every other
/// field as it stands — the manifests-only pass must not revert a dependency
/// or a script somebody added since the directory was generated.
function bumpPackageVersion(path) {
  try {
    const pkg = JSON.parse(readFileSync(path, "utf8"))
    if (pkg.version === VERSION) return
    pkg.version = VERSION
    writeJson(path, pkg)
  } catch {
    // No package.json to keep in step. The manifest is what this mode is for.
  }
}

function main() {
  const force = process.argv.includes("--force")
  const manifestsOnly = process.argv.includes("--manifests")
  const { keys, collisions } = keysByCode(PARTIES)

  const written = []
  const skipped = []
  const absent = []
  const disabled = []

  for (const [code, party] of Object.entries(PARTIES)) {
    if (DISABLED_REFTYPES.has(party.refType)) {
      disabled.push(`${code} (${party.name}) — ${party.status}`)
      continue
    }

    const key = keys[code]
    const dir = join(EXTENSIONS_DIR, key)
    const present = existsSync(dir)

    if (manifestsOnly) {
      // Only what already exists: this mode re-derives, it does not create.
      // Reported apart from `skipped`, which means the opposite thing — a
      // party with no extension yet is not one that was "left alone", and
      // telling its author to pass --force would be telling them to rewrite
      // what is not there.
      if (!present) {
        absent.push(key)
        continue
      }
      writeJson(join(dir, "manifest.json"), manifestFor(code, key, party))
      // The manifest carries VERSION, so leaving package.json behind splits
      // the two silently. Only that field is touched: everything else in
      // there may have been edited by hand since it was generated.
      bumpPackageVersion(join(dir, "package.json"))
      written.push(key)
      continue
    }

    if (present && !force) {
      skipped.push(key)
      continue
    }

    mkdirSync(join(dir, "src"), { recursive: true })
    writeJson(join(dir, "manifest.json"), manifestFor(code, key, party))
    writeJson(join(dir, "package.json"), packageJsonFor(key, party))
    writeFileSync(join(dir, "tsconfig.json"), TSCONFIG)
    writeFileSync(join(dir, "build.mjs"), BUILD_MJS)
    writeFileSync(join(dir, "src", "index.ts"), indexTsFor(code, party))
    written.push(key)
  }

  for (const { code, abbr, key, name } of collisions) {
    console.log(`collision: '${abbr}' names more than one party; ${name} keeps its code — ${key}`)
  }
  for (const line of disabled) console.log(`not shipped: ${line}`)
  console.log(`wrote ${written.length}: ${written.join(" ") || "none"}`)
  if (skipped.length) console.log(`already present, left alone (--force to rewrite): ${skipped.join(" ")}`)
  if (absent.length) {
    console.log(`no extension to re-derive, so nothing written (run without --manifests to create): ${absent.join(" ")}`)
  }
}

main()
