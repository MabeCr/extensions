# Workflow Profile — Ham2K Extensions (Extensions)

Everything project-specific that the `ham2k-workflow` skills (`/next`,
`/iterate`, `/finalize`, `/merge`, `/done`) need. The skills hold the shape
of the process; this file holds what only this repo knows. Keep the section
headings — the skills reference them by name.

## Repo

- **origin**: `ham2k/extensions` (`git@github.com:ham2k/extensions.git`) —
  single remote, and it is **public**: whatever lands on `main` is published as
  it stands, this file included. There is no private mirror or filtered branch.
- **base branch**: `main` on `origin`, the only base. Branch off
  `origin/main`, never off local `main` or whatever is checked out.
- **CI**: none. The repo has no `.github/`, so nothing runs on a push, to any
  branch. The local gate is the only check `main` ever gets. Work stays
  local; a push to `origin` is a backup, not a review request.
- **session tag**: `[Extensions]`.

## Tracking

- **CaBo project**: none — tracking is chat-only. `/next` presents its plan
  in chat rather than on a card, and `/merge` has no card to close.

## Branches and worktrees

- **branch names**: `sd/<short-description>` (`sd/qso-party`).
- **worktrees**: required. Every extension builds into its own `build/` and
  packs to `<key>-<version>.h2kext` beside it, and `bundles.test.ts` builds and
  packs all of them, so two sessions in one checkout overwrite each other's
  bundles mid-run and one of them tests the other's code.
- worktree directory: Orca creates them under `.orca/workspaces/extensions/`
  (gitignored), i.e. UNDER the main checkout — see *Bootstrap* for why that
  matters.

## Bootstrap

What a fresh worktree or clone needs before it builds. Each missing piece
fails like a code error, not a setup one.

```sh
npm ci
```

A worktree without its own `node_modules` does not fail: Node and `tsc` walk up
the tree and find the main checkout's `node_modules`, whose workspace symlinks
point at the main checkout's `packages/`. Typecheck and tests then run against
the main checkout's copy of every shared package — a change to
`packages/qso-parties` in the worktree is invisible, and the errors that do
appear name properties that plainly exist in the file you are looking at.

`H2K_CATALOG_TOKEN` (needed only to publish) comes from `mise.local.toml` in
the main checkout (gitignored), which mise also applies in every worktree
beneath it. Nothing else is gitignored and required.

## Gate

The one command that decides whether the work is good. There is no CI at all,
so this local run IS the gate.

```sh
npm run typecheck && npm test
```

`npm test` runs every workspace's `test` script, then `extensions/bundles.test.ts`,
which builds, packs and loads every extension — that last part is the only
coverage the 49 generated QSO-party events and the libraries without a `test`
script (`lib-gma-spots`, `lib-vhf-contests`) have of their own, besides the
engine tests in `lib-qso-party` and `qso-parties`. A green run reports
`fail 0` across ~1,300 tests.

- **Fast subset**: one workspace, by its package name —
  `npm test -w @ham2k/qso-parties`, `npm test -w @ham2k/ext-ki2d-qso-party-spots`.
  The names are each `package.json`'s `name` (`@ham2k/ext-<key>` for an
  extension).
- **What a narrower run skips**: a workspace run never reaches
  `bundles.test.ts`, so it cannot see a bundle that fails to build or pack, a
  host library the manifest does not declare, or a hook the manifest promises
  and the code never registers. It also skips every OTHER workspace that
  imports a shared package you changed: an edit under `packages/` is only
  tested by the full gate.

## Running the app

There is no app here. Extensions run inside Ham2K Logger (app-polo / HaLo),
loaded from the catalog.

- **trying one on a device**: a `ham2k-` key is refused when side-loaded from
  a file; the only way onto a device is publishing it to the catalog (a
  `bleeding` channel release reaches only someone who opted in). A `ki2d-` key
  installs from its packed `.h2kext` like any third-party extension.
- **quick compile check**: `npm run typecheck -w @ham2k/ext-<key>` (under a
  second) — or the package name of the `packages/*` library being edited.
- **build one bundle**: `npm run build -w @ham2k/ext-<key>`;
  `npm run pack -w @ham2k/ext-<key>` writes the `.h2kext`.
- **previewing a panel** — the closest thing to a running app, and what
  `/iterate` keeps up for panel work:
  `node scripts/preview-panels.mjs extensions/dashboard/<key> [port]`
  (default port 4417), run from the worktree root. It builds the extension,
  loads the bundle against a stand-in kernel and serves every panel at
  several sizes in light and dark, plus the cases in the extension's
  `preview.json`. A change under `src/`, or to `manifest.json` or
  `preview.json`, rebuilds and re-renders by itself and the open page
  follows; a change to the script itself needs a restart. Its log prints
  `rendered N panels` on each render, and `ERROR` for a failed build,
  render or event — watch for that. `LOG` lines are the extension's own
  `host.log`, and `HOST <call> is not stood in for` names a host call the
  stand-in answers with `{}`. Text is laid out by the browser rather than
  Flutter, so spacing and fit are close, not exact.

## Finding this worktree's processes

Builds and tests run to completion in the foreground. The one long-lived
process is a panel preview, found by its working directory:

```sh
for pid in $(pgrep -f 'scripts/preview-panels.mjs'); do
  [ "$(lsof -a -p "$pid" -d cwd -Fn | sed -n 's/^n//p')" = "$(git rev-parse --show-toplevel)" ] && echo "$pid"
done
```

## Deploy and publishing

- **what a push to `main` triggers**: nothing. No CI, no deploy, no catalog
  release. `main` is public, so a push is publication of the SOURCE, nothing
  more.
- **publishing to the catalog** is a separate, explicit act, per extension:

  ```sh
  cd extensions/<category>/<key> && npm run build && npx h2kext-publish build --force-name --notes "<what changed, for operators>"
  ```

  `--force-name` is what lets a `ham2k-` key through: packing a build
  directory checks the key against the third-party naming convention, which
  reserves that prefix, and refuses it otherwise — the same waiver `npm run
  pack` passes. A `ki2d-` key needs no waiver, so leave it off there and let
  the check catch a misnamed one. `npm` is not on PATH outside a mise-activated
  shell: `mise x -- npx …`.

  An agent runs this **only when the user asks for it**, never as part of
  `/merge` or `/finalize`, and only for a version that has merged to `main`.
  Default channel is `stable`; `--channel unstable|bleeding` for anything less
  finished. The result line says `approved` or `pending review` — pending
  means nobody can install it until a reviewer approves it on the catalog.
- **a version's bytes freeze when the catalog approves them**: the same
  version with different bytes is refused, so every fix that will be
  published needs a new version — in BOTH `manifest.json` and `package.json`,
  then `npm install --package-lock-only` to carry it into the lockfile.
- **the pre-loaded set** — `ham2k-pota`, `ham2k-sota`, `ham2k-wwff`,
  `ham2k-dxcc` and the five lookups — also ships packaged inside the app
  (`app/assets/preloaded-extensions/`). Publishing one of those is only half
  the release; the app's copy needs re-packing, which is app-repo work.
- **merge-time hazards**: generated files. `packages/qso-parties/src/parties/*.ts`
  and `identities.ts` are written by `node scripts/convert-parties.mjs`, and
  the 49 `extensions/contests/ham2k-*` events by
  `node scripts/generate-event-extensions.mjs` (`--manifests` for dates only).
  When two branches both regenerated, resolve by re-running the generator on
  the rebased tree, never by hand-merging its output.
- **maintainer-only acts**: none beyond the above — publishing is allowed on
  request.

## Conventions

- **Read `README.md` before touching an area** — it is long because each
  section is a procedure with traps in it: *Adding an extension*, *Adding an
  event*, *Porting a built-in*, *The SDK gap*.
- **Never edit a generated file.** Party modules come from
  `packages/qso-parties/fixtures/*.json`; events come from the party modules.
  Edit the input, re-run the generator, commit both.
- **The fixtures are app-polo's party files, and a re-sync copies polo's
  files over them** (`node scripts/convert-parties.mjs <dir>`). Anything this
  repo knows that polo's files do not lives in `scripts/convert-parties.mjs`
  instead — `DIVERGENCE_NOTES` for party data, `HUB_PAGES` for the QSO Party
  Hub's page names — or the next re-sync silently takes it back.
- **ref types, spot `source` values and logging-control keys are log data**:
  never renamed, even when the package key changes.
- **Imports name the `.ts` file** (`./params.ts`): tests run through
  `node --experimental-strip-types` with no bundler.
- **Commit subjects** are one sentence about what changed for the operator;
  a release leads with `<Extension> <version>:` (`QSO Party Spots 0.2.1: …`).
