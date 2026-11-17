// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// What the IARU Region 1 VHF+ contest family and RSGB's own share: the
// REG1TEST/EDI writer both submit, the grid half of an exchange both send,
// the ref readers both store it with, and the band multiplier both score by.
//
// Here rather than in either extension because a published extension may not
// reach into another one's source, and two copies of a scoring table diverge.
// `reg1test.ts` is a format writer with no contest in it, deliberately the
// shape `@ham2k/lib-qson-cabrillo`'s writer has: if the host ever carries it,
// only the manifests change.

export { BAND_MULTIPLIERS } from './bands.ts'
export { GRID_PATTERN, guessedGrid, isRover, suggestedGrid, trimmedGrid } from './exchange.ts'
export { refOfType, serial, str } from './refs.ts'
export { theirGridFields } from '@ham2k/lib-contest-exchange'
export { REG1TEST_BAND, qsonToReg1test } from './reg1test.ts'
export type { Reg1testOptions, Reg1testQsoFields } from './reg1test.ts'
