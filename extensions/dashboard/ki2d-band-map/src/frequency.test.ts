// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { freqParts, hzDigitsNeeded } from './frequency.ts'
import { bandForKHz, radioModeFor } from './bands.ts'

const us = { group: ',', decimal: '.' }

test('a frequency reads as the QSO list writes it: MHz, then the kHz after a thousands mark, then the Hz', () => {
  assert.deepEqual(freqParts(14074.5, 1, us), { mhz: '14', khz: ',074', hz: '.5' })
  assert.deepEqual(freqParts(7030, 0, us), { mhz: '7', khz: ',030', hz: undefined })
  // The operator's own marks, not a period-decimal reading.
  assert.deepEqual(freqParts(14074.5, 1, { group: '.', decimal: ',' }), { mhz: '14', khz: '.074', hz: ',5' })
})

// 8.158 MHz is 8157.999999999999 kHz as a double: split as a double, it reads 8,157.999 — or 8,157 with 1000 Hz.
test('a frequency on a binary boundary rounds into the next kHz rather than showing 1000 Hz', () => {
  assert.deepEqual(freqParts(8.158 * 1000, 3, us), { mhz: '8', khz: ',158', hz: '.000' })
})

test('below 1 MHz there is no thousands group', () => {
  assert.deepEqual(freqParts(472, 0, us), { mhz: '472', khz: '', hz: undefined })
})

test('the Hz shown are the fewest that show every frequency exactly', () => {
  assert.equal(hzDigitsNeeded([14074, 14075]), 0)
  assert.equal(hzDigitsNeeded([14074, 14074.5]), 1)
  assert.equal(hzDigitsNeeded([14074.05, 14074.5]), 2)
})

test('the band follows the frequency, and a frequency outside every band has none', () => {
  assert.equal(bandForKHz(14074), '20m')
  assert.equal(bandForKHz(5357), '60m')
  assert.equal(bandForKHz(12000), undefined)
})

// Upper sideband on 60 m is the rule there: the below-10-MHz convention would tune it wrong.
test('a spot\'s mode becomes one the radio offers, SSB on its usual sideband', () => {
  const offered = ['LSB', 'USB', 'CW', 'DATA-USB']
  assert.equal(radioModeFor('SSB', 7200, offered), 'LSB')
  assert.equal(radioModeFor('SSB', 14250, offered), 'USB')
  assert.equal(radioModeFor('SSB', 5357, offered), 'USB')
  assert.equal(radioModeFor('FT8', 7074, offered), 'DATA-USB')
  assert.equal(radioModeFor('FT8', 7074, ['LSB', 'USB']), 'USB')
  assert.equal(radioModeFor('CW', 7030, ['LSB', 'USB']), undefined)
})
