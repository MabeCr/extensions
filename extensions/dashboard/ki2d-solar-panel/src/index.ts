// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import { defineExtension, host } from '@ham2k/extension-sdk'
import manifest from '../manifest.json'
import { createSolarPanel } from './solar.ts'

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook('panel', { key: manifest.key, hook: createSolarPanel(host.fetch, form => host.showForm(form), message => host.log(message)) })
  },
})
