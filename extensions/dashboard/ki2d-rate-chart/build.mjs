// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import { build } from 'esbuild'
import { buildExtension } from '@ham2k/extension-tools'
const { outDir } = await buildExtension(build, { dir: import.meta.dirname })
console.log('built', outDir)
