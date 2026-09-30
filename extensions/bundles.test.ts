// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Every extension in this repository BUILDS, PACKS, and LOADS.
//
// Nothing else covers those three. A typecheck sees the source and never the
// bundle, so it cannot see an import the preset failed to rewrite, a manifest
// the packer would refuse, or a hook the manifest promises and nobody
// registers — and each of those is a bundle that installs and then does
// nothing, in someone else's app, with no error anywhere.
//
// The kernel here is a stub: enough of `globalThis.__polo` for the bundle to
// evaluate and hand over its registrations. It is not the host, so this proves
// the bundle LOADS rather than that it scores correctly — the rules are the
// engine's own tests' business.

import assert from "node:assert/strict"
import { readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { createContext, runInContext } from "node:vm"

import { build } from "esbuild"
// @ts-expect-error — the toolchain is deliberately plain JS and ships no types.
import { buildExtension } from "@ham2k/extension-tools"
// @ts-expect-error — as above.
import { findSharedModuleReferences, pack, validateManifest } from "@ham2k/extension-tools/format"
// A NAMESPACE import, so a missing export is a value to test rather than a
// link error that takes the whole file down before any test runs.
// @ts-expect-error — as above.
import * as packerFormat from "@ham2k/extension-tools/format"

/// Whether the installed packer knows the manifest fields these extensions
/// actually use — asserted below, on its own, rather than inside the
/// per-extension loop, so a packer that is merely OLD reads as one problem
/// and not as ninety broken extensions.
///
/// `validateManifest` is the only thing in this repo that reads a manifest's
/// CONTENT, and it comes from a published package rather than from halo's
/// working copy. A packer older than a field does not look at that field at
/// all: every manifest passes, and `"interests": ["CW"]`,
/// `"dates": ["2026-02-31"]` or a misspelt `"relevence"` all ship green.
///
/// `validateRelevance`'s presence is the probe, because that export arrived
/// with those fields.
const packerKnowsRelevance = typeof (packerFormat as Record<string, unknown>).validateRelevance === "function"

test("the installed packer is new enough to validate what these manifests say", () => {
  // Not this repo's bug to fix — it is one `npm install` away from a
  // published packer that has it — but it must not pass in silence, because
  // what it hides is 89 manifests that nothing validated. Everything else
  // here still runs: the older packer checks keys, api and shared
  // dependencies, and only the manifest CONTENT goes unchecked.
  assert.ok(
    packerKnowsRelevance,
    "@ham2k/extension-tools is older than `relevance` (no validateRelevance export), so every manifest's " +
      "relevance, dates, interests and enabledByDefault go unchecked here. Publish the packer and update it.",
  )
})

const extensionsDir = dirname(fileURLToPath(import.meta.url))

/// The libraries the host hands every extension, stubbed down to what a bundle
/// touches while its modules INITIALIZE — the country file the SDK's `dxcc`
/// module registers on import, and the mode tables its `modes` module builds a
/// set from. Everything else is read from inside a hook, which this test never
/// runs.
///
/// Deliberately not a Proxy answering everything: esbuild's CJS interop copies
/// a module's own property names once, at import, so a Proxy would hand the
/// bundle an EMPTY namespace and every failure would arrive as `undefined is
/// not a function` far from here.
function stubSharedModules(): Record<string, Record<string, unknown>> {
  return {
    "@ham2k/lib-callsigns": { parseCallsign: (call: string) => ({ call }) },
    "@ham2k/lib-country-files": {
      useBuiltinCountryFile: () => {},
      annotateFromCountryFile: (info: unknown) => info,
    },
    "@ham2k/lib-dxcc-data": { CONTINENTS: {}, DXCC_BY_CODE: {}, DXCC_BY_PREFIX: {} },
    "@ham2k/lib-format-tools": {},
    "@ham2k/lib-geo-tools": {},
    "@ham2k/lib-operation-data": {
      ADIF_MODES_AND_SUBMODES: [],
      ADIF_SUBMODES_BY_MODE: {},
      MODES: [],
      superModeForMode: (mode: string) => mode,
      // The VHF+ contest families spread these into their event tables while
      // the module initializes, so a missing one is a TypeError before any
      // hook is registered rather than an empty list somewhere later.
      VHF_BANDS: [],
      UHF_BANDS: [],
      SHF_BANDS: [],
      EHF_BANDS: [],
    },
    "@ham2k/lib-qson-cabrillo": {},
    "i18next": { default: {}, createInstance: () => ({}) },
    "liquidjs": { Liquid: class {} },
  }
}

interface Registration {
  category: string
  key: string
  hook: Record<string, unknown>
}

/// Evaluates a built bundle against a stub kernel and answers what it
/// registered. A fresh context per bundle, because two extensions loaded into
/// one would share the SDK's module-level state and the second could read as
/// working on the strength of the first.
function loadBundle(source: string): { definition: Record<string, unknown>; registrations: Registration[] } {
  const registrations: Registration[] = []
  let definition: Record<string, unknown> | undefined

  const sandbox: Record<string, unknown> = {}
  sandbox.globalThis = sandbox
  sandbox.__polo = {
    sharedModules: stubSharedModules(),
    /// Activation is allowed to talk to the host, and one extension does:
    /// call-notes reads its own settings there to learn which note files the
    /// operator added. An empty answer gives every such read its defaults.
    /// Not answering at all is what breaks — the read rejects inside an async
    /// onActivation, where nothing is waiting to catch it, and the rejection
    /// takes the whole run down naming a line in a bundle.
    hostCall: async () => ({}),
    defineExtension(def: Record<string, unknown>) {
      definition = def
      const onActivation = def.onActivation as (api: unknown) => void
      onActivation({
        registerHook(category: string, { hook, key }: { hook: Record<string, unknown>; key: string }) {
          registrations.push({ category, key, hook })
        },
      })
    },
  }

  runInContext(source, createContext(sandbox))

  assert.ok(definition, "the bundle evaluated without ever calling defineExtension")
  return { definition, registrations }
}

/// Which directory a manifest `category` belongs in. The manifest names one
/// extension's category and the directory names a group of them, so the two
/// differ by a plural — and the spellings are the app's own source tree's, so
/// that a built-in ported here lands in the directory it came from.
const DIRECTORY_FOR_CATEGORY: Record<string, string> = {
  activity: "activities",
  contest: "contests",
  dashboard: "dashboard",
  lookup: "lookups",
  spots: "spots",
}

/// Every extension, as `<category>/<key>` relative to this directory.
///
/// Two levels deep, because the tree groups extensions under the manifest's own
/// `category`. Walked rather than listed — an extension added and never named
/// here would be one nobody builds, which is the state this test exists to end,
/// and a whole CATEGORY added and never named would hide a dozen at once.
async function extensionDirs(): Promise<string[]> {
  const found: string[] = []
  for (const category of await readdir(extensionsDir, { withFileTypes: true })) {
    if (!category.isDirectory()) continue
    for (const entry of await readdir(join(extensionsDir, category.name), { withFileTypes: true })) {
      if (entry.isDirectory()) found.push(`${category.name}/${entry.name}`)
    }
  }
  return found.sort()
}

test("every extension builds, packs and loads", async (t) => {
  const dirs = await extensionDirs()
  assert.ok(dirs.length >= 3, `expected the extensions to be here, found ${dirs.join(", ") || "none"}`)

  for (const name of dirs) {
    await t.test(name, async () => {
      const dir = join(extensionsDir, name)
      const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"))

      // The tree IS the categorisation, so a misfiled extension is one filed
      // under a heading its manifest contradicts — and since the walk above
      // discovers whatever it finds, nothing else would ever say so.
      const [category, key] = name.split("/")
      assert.equal(DIRECTORY_FOR_CATEGORY[manifest.category as string], category, `${name} sits under the wrong category`)
      assert.equal(manifest.key, key, `${name}'s directory is not its key`)

      // `forceName` waives the callsign-prefix rule and NOTHING else — the same
      // waiver `h2kext-pack --force-name` applies, and the only reason a
      // `ham2k-` key is allowed to pack at all.
      assert.deepEqual(validateManifest(manifest, { forceName: true }), [], `${name}'s manifest would not pack`)

      const { outDir } = await buildExtension(build, { dir, logLevel: "silent" })
      const bundle = await readFile(join(outDir, "index.js"), "utf8")

      // The sandbox evaluates a script and has no module loader, so a bundle
      // that kept an `import` is one that loads and then does nothing.
      assert.doesNotMatch(bundle, /^import\s/m, `${name} built with imports left in it`)

      // Everything it takes from the host, it declared. The host version-checks
      // what a bundle declares before loading it; an undeclared lookup is one
      // it cannot check, and it dies at the first call instead.
      const declared = Object.keys(manifest.sharedDependencies ?? {})
      for (const used of findSharedModuleReferences(bundle) as string[]) {
        assert.ok(declared.includes(used), `${name} reaches ${used} without declaring it`)
      }

      // Packed into a temp file: the real archive, refused for the real reasons,
      // without leaving a `.h2kext` beside the source for the next release to
      // pick up.
      const outPath = join(await tempDir(), `${manifest.key}-${manifest.version}.h2kext`)
      const packed = await pack(outDir, { outPath, forceName: true })
      assert.equal(packed.manifest.key, manifest.key)
      await rm(dirname(outPath), { recursive: true, force: true })

      const { definition, registrations } = loadBundle(bundle)
      assert.equal(definition.key, manifest.key)

      // An export must be configurable before an operation is open.
      for (const registration of registrations.filter((r) => r.category === 'export')) {
        assert.equal(typeof registration.hook.getExportTypes, 'function', `${name} must register its export types`)
        const getTypes = registration.hook.getExportTypes as () => Promise<{exportType: string; format: string}[]>
        const types = await getTypes()
        assert.ok(types.length > 0, `${name} has no registered export types`)
        assert.equal(new Set(types.map((type) => type.exportType)).size, types.length)
        for (const type of types) {
          assert.ok(['adif', 'cabrillo', 'reg1test'].includes(type.format))
          assert.ok(!type.exportType.startsWith('ham2k-'), 'settings belong to an activity, not a catalog key')
          assert.ok(!type.exportType.includes(':'), 'individual file keys do not belong in a shared export type')
        }
        // A Cabrillo is written by the HOST's copy of the writer. A unit test
        // resolves the package from node_modules and cannot tell a bundle that
        // reaches the shared module from one that does not — and a bundle that
        // does not writes an EMPTY file on the host. Derived from what each
        // bundle registers, so a contest added later is checked without being
        // named anywhere.
        if (types.some((type) => type.format === 'cabrillo')) {
          assert.ok(
            (findSharedModuleReferences(bundle) as string[]).includes('@ham2k/lib-qson-cabrillo'),
            `${name} offers a Cabrillo without reaching the host's @ham2k/lib-qson-cabrillo`,
          )
        }
      }

      // What the manifest PROMISES is what the bundle registers. The panel and
      // the catalog read this list without loading anything, so a promise
      // nobody keeps is an extension the operator is told does something it
      // does not.
      //
      // Deduplicated, because a category is legitimately registered twice under
      // two keys (POTA's activator and hunter exports) and `hooks` names each
      // category once.
      const isRef = (category: string) => category.startsWith("ref:")
      const declaredHooks = [...new Set(manifest.hooks as string[])]
      const registered = [...new Set(registrations.map((r) => r.category))]

      // A PLAIN category matches both ways: the host decides what an extension
      // IS from these, so one registered off the list is one it was never told
      // to expect.
      assert.deepEqual(
        registered.filter((c) => !isRef(c)).sort(),
        declaredHooks.filter((c) => !isRef(c)).sort(),
        `${name}'s manifest.hooks and its registrations disagree`,
      )

      // A `ref:` entry is one-directional, deliberately: it claims to publish a
      // CONTROL for that type, not merely to answer for it. WCA registers for
      // English and Belgian castle references and WWBOTA for the legacy UKBOTA
      // ones, and neither may DECLARE those — the host reads this list to offer
      // enabling a switched-off extension for an unhandled ref, and an offer
      // that leads to no control leaves the row exactly as red as it was. So a
      // declared type must be registered; a registered one need not be
      // declared. The app's own `extensions/hook-check.mjs` is the spec.
      const unanswered = declaredHooks.filter(isRef).filter((c) => !registered.includes(c)).sort()
      assert.deepEqual(unanswered, [], `${name} lists ${unanswered.join(", ")} in hooks but registers nothing for it`)

      // Every hook inside the extension's own key namespace — its key, or a
      // `<key>-…` under it, which is the shape the kernel's own `bundleMayDefine`
      // reasons about. A hook registered outside it is one the app attributes to
      // an extension that may not even be installed.
      for (const registration of registrations) {
        assert.ok(
          registration.key === manifest.key || registration.key.startsWith(`${manifest.key}-`),
          `${registration.category} registered under '${registration.key}', outside '${manifest.key}'`,
        )
      }

      // A `ref:` entry names a ref TYPE the extension publishes a control for,
      // and a scoped scorer names the types it scores. The two disagreeing is a
      // scoreboard that stays at zero for an operation whose ref is right there
      // — and each half looks correct on its own. Against the DECLARED types,
      // not every registered one: the types an extension merely answers for
      // (WCA's English and Belgian castles) belong to whichever extension does
      // publish them, and scoring them here would count an activation twice.
      // An unscoped scorer runs for every operation and is not this check's
      // business; an extension with no scorer at all (a plain reference activity)
      // is not either.
      // A qualified claim (`ref:qp/ny`) contributes its TYPE: the scorer is
      // filtered by type, and an operation carrying the legacy pair has to
      // reach the scorer that answers for it or it scores zero while its row
      // sits there answered.
      const refTypes = [
        ...new Set(declaredHooks.filter(isRef).map((c) => c.slice("ref:".length).split("/")[0])),
      ]
      const scoring = registrations.find((r) => r.category === "scoring")
      // Spread first: the scope came out of the vm realm, and an array from
      // another realm is never deep-STRICT-equal to one built here.
      const scoped = (scoring?.hook.scope as { refTypes?: string[] } | undefined)?.refTypes
      if (scoped) {
        assert.deepEqual([...scoped].sort(), refTypes.sort(), `${name}'s scorer is scoped to other ref types`)
      }
    })
  }
})

async function tempDir(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises")
  return mkdtemp(join(tmpdir(), "h2kext-bundle-"))
}
