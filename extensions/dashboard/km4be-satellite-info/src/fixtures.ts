// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// What the feeds served, kept for the tests.

// Elements as CelesTrak served them on 2026-10-06 (the amateur group).
export const AO7 = { OBJECT_NAME: "OSCAR 7 (AO-7)", OBJECT_ID: "1974-089B", EPOCH: "2026-10-06T20:57:22.256064", MEAN_MOTION: 12.5369988, ECCENTRICITY: 0.00119476, INCLINATION: 101.991, RA_OF_ASC_NODE: 294.2846, ARG_OF_PERICENTER: 278.5192, MEAN_ANOMALY: 203.4257, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: "U", NORAD_CAT_ID: 7530, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 37451, BSTAR: 9.5510357e-5, MEAN_MOTION_DOT: -3.1e-7, MEAN_MOTION_DDOT: 0 }
export const FO29 = { OBJECT_NAME: "JAS-2 (FO-29)", OBJECT_ID: "1996-046B", EPOCH: "2026-10-06T19:16:29.539488", MEAN_MOTION: 13.53278743, ECCENTRICITY: 0.03500586, INCLINATION: 98.5144, RA_OF_ASC_NODE: 113.3665, ARG_OF_PERICENTER: 166.6099, MEAN_ANOMALY: 194.463, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: "U", NORAD_CAT_ID: 24278, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 48826, BSTAR: 0.000042211991, MEAN_MOTION_DOT: 8e-8, MEAN_MOTION_DDOT: 0 }

// The Ham2K list as it is today, faults included: FO-29's number has a stray digit,
// SO-125 has none, and CAS-4A has a number CelesTrak publishes nothing for.
export const LIST = [
  { name: "AO-7", number: 7530, modulation: "linear", uplinks: [{ mode: "linear", lowerMHz: 145.85, upperMHz: 145.95 }], downlinks: [{ mode: "linear", lowerMHz: 29.4, upperMHz: 29.5 }] },
  { name: "FO-29", number: 424278, modulation: "linear", uplinks: [{ mode: "linear", lowerMHz: 145.9, upperMHz: 146 }], downlinks: [{ mode: "linear", lowerMHz: 435.8, upperMHz: 435.9 }] },
  { name: "SO-125", modulation: "fm", uplinks: [], downlinks: [] },
  { name: "CAS-4A", number: 42761, modulation: "linear", uplinks: [], downlinks: [] },
  { name: "", number: 1 },
]
export const ELEMENTS = [AO7, FO29, { NORAD_CAT_ID: "bad" }]
