// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import { defineExtension } from '@ham2k/extension-sdk'
import manifest from '../manifest.json'
import { createRatePanel } from './chart.ts'

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook('panel', { key: manifest.key, hook: createRatePanel() })
  },
})
