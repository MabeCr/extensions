// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT

import { defineExtension } from "@ham2k/extension-sdk"
import { registerOfflineCalls } from "@ham2k/lib-ham2k-calls/offline"

import manifest from "../manifest.json" with { type: "json" }

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerOfflineCalls(registerHook, { key: manifest.key, set: "all" })
  },
})
