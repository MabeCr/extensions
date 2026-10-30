// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Running a finger along a pass. A slider laid over the sky plot, whose value is a moment of the
// pass, moves a marker along the path and writes what the Doppler shift is then in the plot's corners.
// Everything it shows at every moment is worked out here and handed to the host as samples, so
// dragging is answered on the device with no call back to the extension. Mouse hover does the
// same on a desktop.
//
// The slider rests one past the last moment, where the marker is hidden and the plot shows what it
// always did: that is the value a scene starts with.

import type { PanelSceneControl, PanelSceneLayer, SceneBinding } from "@ham2k/extension-sdk"

import type { Satellite } from "./data.ts"
import { satrecFromOmm } from "./orbit.ts"
import type { Observer, Pass } from "./orbit.ts"
import { clock } from "./passes.ts"
import { liveDoppler, shiftText } from "./radio.ts"
import { READOUT_BOXES, SCRUB_BOX, SKY_SIZE, skyXY } from "./sky.ts"
import type { SkyPoint } from "./sky.ts"

export const SCRUB_VALUE = "scrub"
export const SCRUB_RESET = "scrubReset"
const MARKER = 26

/// Where the Reset button is on the plot: the bottom right corner, which is outside the circle of the sky and clear of the
/// time readout at the bottom left.
export const RESET_BOX = { x: 244, y: 318, width: 112, height: 38 }

export interface Scrub {
  /// The slider's value at rest; the moments are 0 up to one less.
  rest: number
  layers: PanelSceneLayer[]
  control: PanelSceneControl
  /// A button over the corner of the plot that puts the slider back at rest. It is there only while the slider is on a moment.
  reset: PanelSceneControl
}

/// A binding that is `shown` while the slider is at rest and its opposite while it is on a moment.
const whileResting = (rest: number, shown: 0 | 1): SceneBinding => ({ value: SCRUB_VALUE, input: [rest - 1, rest], output: [1 - shown, shown] })

/// The layers and the slider, or null when there is no orbit or too little of a pass to scrub.
export function buildScrub(
  satellite: Satellite,
  observer: Observer,
  pass: Pass,
  track: SkyPoint[],
  utc: boolean,
  textColor: string,
  markerColor: string,
): Scrub | null {
  if (!satellite.omm || track.length < 2) return null
  const satrec = satrecFromOmm(satellite.omm)
  const rest = track.length
  const moments = track.map((p) => ({ p, xy: skyXY(p.azimuth, p.elevation), shift: liveDoppler(satellite, observer, p.at, satrec) }))
  const idle = (texts: string[]) => [...texts, ""]

  const marker: PanelSceneLayer = {
    id: "scrubAt",
    x: 0,
    y: 0,
    width: MARKER,
    height: MARKER,
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARKER} ${MARKER}">` +
      `<circle cx="${MARKER / 2}" cy="${MARKER / 2}" r="${MARKER / 2 - 2}" fill="${markerColor}" fill-opacity="0.35" stroke="${markerColor}" stroke-width="3"/>` +
      `<circle cx="${MARKER / 2}" cy="${MARKER / 2}" r="3" fill="${markerColor}"/></svg>`,
    translateX: { value: SCRUB_VALUE, input: [0, rest - 1], output: [0, 0], samples: moments.map((m) => +(m.xy.x - MARKER / 2).toFixed(1)) },
    translateY: { value: SCRUB_VALUE, input: [0, rest - 1], output: [0, 0], samples: moments.map((m) => +(m.xy.y - MARKER / 2).toFixed(1)) },
    opacity: whileResting(rest, 0),
  }

  const text = (id: string, box: { x: number; y: number; width: number; height: number }, row: number, samples: string[], align: "start" | "end"): PanelSceneLayer => ({
    id,
    x: box.x,
    y: box.y + row * 16,
    width: box.width,
    height: 16,
    opacity: whileResting(rest, 0),
    text: { value: SCRUB_VALUE, samples: idle(samples), size: 12, color: textColor, align, fontWeight: 600 },
  })
  const layers: PanelSceneLayer[] = [marker]
  if (moments.some((m) => m.shift?.down)) {
    layers.push(
      text("scrubDnFreq", READOUT_BOXES[0], 0, moments.map((m) => (m.shift?.down ? `↓ ${m.shift.down.mhz.toFixed(4)}` : "")), "start"),
      text("scrubDnShift", READOUT_BOXES[0], 1, moments.map((m) => (m.shift?.down ? shiftText(m.shift.down.kHz) : "")), "start"),
    )
  }
  if (moments.some((m) => m.shift?.up)) {
    layers.push(
      text("scrubUpFreq", READOUT_BOXES[1], 0, moments.map((m) => (m.shift?.up ? `↑ ${m.shift.up.mhz.toFixed(4)}` : "")), "end"),
      text("scrubUpShift", READOUT_BOXES[1], 1, moments.map((m) => (m.shift?.up ? shiftText(m.shift.up.kHz) : "")), "end"),
    )
  }
  layers.push(text("scrubAtTime", SCRUB_BOX, 0, moments.map((m) => `${clock(m.p.at, pass.aos, utc, true)} · ${Math.round(m.p.elevation)}°`), "start"))

  const control: PanelSceneControl = {
    id: "scrub",
    kind: "slider",
    label: "Move along the pass to see the Doppler shift",
    x: 0,
    y: 0,
    width: SKY_SIZE,
    height: SKY_SIZE,
    value: SCRUB_VALUE,
    min: 0,
    max: rest,
    step: 1,
    hover: true,
    valueLabels: idle(moments.map((m) => `${clock(m.p.at, pass.aos, utc, true)}, ${Math.round(m.p.elevation)}° up`)),
  }
  // After the slider in the scene, so that it is above it and takes the tap. At rest it is gone, and takes none.
  const reset: PanelSceneControl = {
    id: SCRUB_RESET,
    kind: "nativeButton",
    label: "Reset",
    variant: "tonal",
    event: SCRUB_RESET,
    ...RESET_BOX,
    opacity: whileResting(rest, 0),
  }
  return { rest, layers, control, reset }
}

/// The live readout in the corners gives way to the scrubbed one while the slider is on a moment.
export const hideWhileScrubbing = (layers: PanelSceneLayer[], rest: number): PanelSceneLayer[] => layers.map((l) => ({ ...l, opacity: whileResting(rest, 1) }))
