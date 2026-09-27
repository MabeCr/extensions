// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The engine's own words in the score summary, per locale. Everything else the
// engine says is a `QsoPartyLabel` a party may override; these are not, because
// no sponsor's rules name them.

import { createCachedTranslator } from "@ham2k/extension-sdk"

import en from "./i18n/en.json" with { type: "json" }
import es from "./i18n/es.json" with { type: "json" }

/// Translator for the engine's strings, cached per locale.
export const tFor = createCachedTranslator({ en: { translation: en }, es: { translation: es } })
