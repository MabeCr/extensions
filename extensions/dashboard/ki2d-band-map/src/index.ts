// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import { defineExtension, host } from '@ham2k/extension-sdk'
import manifest from '../manifest.json'
import { createBandMap } from './bandmap.ts'
import { suggestQsoThrough } from './sdkGap.ts'
defineExtension({ ...manifest, onActivation({ registerHook, hostCall }) {
  registerHook('panel', { key: manifest.key, hook: createBandMap({ ...host, suggestQso: suggestQsoThrough(hostCall) }) })
} })
