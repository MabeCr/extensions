// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// ARRL's DXCC, kept as a chasing program's checklist (./program.ts): Mixed,
// each mode group and each band, with the DXCC Challenge tallied from the
// band slots.

import { defineExtension } from "@ham2k/extension-sdk"

import { dxccProgram } from "./program.ts"

import manifest from "../manifest.json" with { type: "json" }

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook("chasing", { hook: dxccProgram, key: manifest.key })
  },
})
