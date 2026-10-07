// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Builds this extension the way any third party builds one: esbuild is ours to
// bring, the preset carries the settings the sandbox requires, and everything
// `manifest.json` declares under `sharedDependencies` becomes a lookup on the
// host's single copy rather than a second copy in the bundle.
//
//   node build.mjs && npx h2kext-pack build
//
// `--force-name` is what a `ham2k-` key needs — see the repository README.

import { build } from 'esbuild'
import { buildExtension } from '@ham2k/extension-tools'

const { outDir } = await buildExtension(build, { dir: import.meta.dirname })

console.log('built', outDir)
