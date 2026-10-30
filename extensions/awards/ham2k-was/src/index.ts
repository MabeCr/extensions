// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Worked All States: ARRL's award for a contact with each of the 50 states,
// kept as a chasing program's checklist (./program.ts).

import { defineExtension } from "@ham2k/extension-sdk"

import { wasProgram } from "./program.ts"

import manifest from "../manifest.json" with { type: "json" }

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook("chasing", { hook: wasProgram, key: manifest.key })
  },
})
