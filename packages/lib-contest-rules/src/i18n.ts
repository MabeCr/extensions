// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The rules line's words, per locale. The same in every contest, so they live
// here rather than in each extension's catalog.

import { createCachedTranslator } from "@ham2k/extension-sdk"

import en from "./i18n/en.json" with { type: "json" }
import es from "./i18n/es.json" with { type: "json" }

/// Translator for this package's strings, cached per locale.
export const tFor = createCachedTranslator({ en: { translation: en }, es: { translation: es } })
