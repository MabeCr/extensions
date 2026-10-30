// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The picture the list of panels shows for this one: a sky plot with a pass across it, and a few rows of a list
// with their marks. Drawn as shapes, since the host takes a still SVG, never a URL, and text is not portable in one.

const BACKGROUND = "#1a1d21"
const LINE = "#8a8f98"
const PATH = "#1ea0d6"
const ROW = "#4a90d9"

const rows = [
  { y: 30, w: 88, mark: "#43a047" },
  { y: 54, w: 76, mark: "#f9a825" },
  { y: 78, w: 92, mark: "#43a047" },
  { y: 102, w: 70, mark: "#e53935" },
  { y: 126, w: 84, mark: "#43a047" },
]

export const PREVIEW_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">` +
  `<rect width="320" height="180" rx="10" fill="${BACKGROUND}"/>` +
  // the sky: three rings and the cross of the compass, a pass across it, a green rise and a red set
  `<g fill="none" stroke="${LINE}" stroke-width="1" opacity="0.7">` +
  `<circle cx="86" cy="90" r="68"/><circle cx="86" cy="90" r="45"/><circle cx="86" cy="90" r="22"/>` +
  `<path d="M86 22V158M18 90H154"/></g>` +
  `<path d="M40 142Q74 38 130 54" fill="none" stroke="${PATH}" stroke-width="3" stroke-linecap="round"/>` +
  `<circle cx="40" cy="142" r="5" fill="#43a047"/><circle cx="130" cy="54" r="5" fill="#e53935"/><circle cx="78" cy="78" r="4" fill="#eeeeee"/>` +
  // a list: a star, a line of text and the mark of AMSAT's reports at the end of each row
  rows
    .map((r) => `<path d="M182 ${r.y}l3 6 6.5 1-4.7 4.5 1.2 6.5-6-3.2-6 3.2 1.2-6.5-4.7-4.5 6.5-1z" fill="none" stroke="${ROW}" stroke-width="1.4"/>` +
      `<rect x="204" y="${r.y + 4}" width="${r.w}" height="8" rx="4" fill="${ROW}" opacity="0.85"/>` +
      `<circle cx="304" cy="${r.y + 8}" r="5" fill="${r.mark}"/>`)
    .join("") +
  `<rect x="182" y="152" width="20" height="8" rx="4" fill="${LINE}" opacity="0.6"/><rect x="278" y="152" width="26" height="8" rx="4" fill="${LINE}" opacity="0.6"/>` +
  `</svg>`
