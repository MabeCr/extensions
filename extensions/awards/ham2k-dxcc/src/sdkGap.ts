// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// What a chasing program says about its own notices, ahead of the SDK: the
// published `ChasingProgram` has no `notices` yet, and an app that does not
// read them words each verdict its own way ("New DXCC", "New DXCC mode").
// Delete this file, and widen nothing, the day the SDK publishes them.

import type { ChasingProgram } from "@ham2k/extension-sdk"

/// The verdicts a program can word for itself.
export type ChaseNoticeVerdict = "newRef" | "newBand" | "newMode" | "unconfirmed"

/// A notice's words, by verdict. `{{band}}` and `{{mode}}` name the band and
/// mode of the claim the verdict is about — the mode through `modeLabels`
/// when the program gives one — and a verdict left out reads the app's way.
export interface ChaseNoticeLabels {
  notices?: Partial<Record<ChaseNoticeVerdict, string>>
  modeLabels?: Record<string, string>
}

export type ChasingProgramWithNotices = ChasingProgram &
  ChaseNoticeLabels & {
    /// The same, per locale, over the program's own words: the manifest's
    /// `translations` shape.
    translations?: Record<string, ChaseNoticeLabels>
  }
