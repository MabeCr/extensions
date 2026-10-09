// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Everything this extension remembers between redraws, in one place to be forgotten from.
//
// The device's storage keeps the feeds across restarts, but every read of it is a round trip
// to the host, and the panel is redrawn on every tap, every minute, and, with the countdown
// on, every second. So what has been read is also kept here, in memory, and a redraw within
// the time a thing is good for asks the host for nothing. Each cache registers a way to
// empty itself; tests call `forgetAll` so one test's memory is not the next one's.

const forgetters: (() => void)[] = []

/// Registers how a cache empties itself.
export function onForget(forget: () => void): void {
  forgetters.push(forget)
}

/// For tests: empties every cache.
export function forgetAll(): void {
  for (const forget of forgetters) forget()
}
