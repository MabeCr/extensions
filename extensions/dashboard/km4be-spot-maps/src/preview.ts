// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The picture the list of panels shows for this one: a sketch of the world with dots on it, in the map's own colors. Drawn as
// shapes, since the host takes a still SVG, never a URL, and text is not portable in one.

const dots = [
  { x: 62, y: 70, c: "#2ca02c" },
  { x: 74, y: 82, c: "#e6ab02" },
  { x: 88, y: 66, c: "#1f77b4" },
  { x: 96, y: 92, c: "#2ca02c" },
  { x: 150, y: 60, c: "#d62728" },
  { x: 160, y: 72, c: "#17becf" },
  { x: 168, y: 58, c: "#2ca02c" },
  { x: 214, y: 96, c: "#e377c2" },
  { x: 254, y: 120, c: "#bcbd22" },
  { x: 120, y: 120, c: "#9467bd" },
]

export const PREVIEW_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">` +
  `<rect width="320" height="180" rx="10" fill="#10243a"/>` +
  // land, as blobs: the Americas, Europe and Africa, Asia, Australia
  `<g fill="#2b3f4f"><path d="M40 50c16-14 44-14 60 2l12 22-10 20-18 10-6 26-14 6-8-24-16-18z"/>` +
  `<path d="M130 52c14-8 30-6 38 4l8 24-10 16 6 28-16 14-18-20-4-26-12-14z"/>` +
  `<path d="M186 48c24-12 62-8 80 12l8 26-24 14-24-6-22 10-16-20z"/>` +
  `<path d="M246 116c10-6 28-4 32 6l-4 14-26 2z"/></g>` +
  // a dot to a station, and one picked
  dots.map((d) => `<circle cx="${d.x}" cy="${d.y}" r="4" fill="${d.c}" stroke="#000" stroke-opacity="0.6"/>`).join("") +
  `<circle cx="160" cy="72" r="9" fill="none" stroke="#ffffff" stroke-width="2"/>` +
  // the strip along the bottom where a drag zooms
  `<rect x="14" y="160" width="292" height="4" rx="2" fill="#ffffff" fill-opacity="0.35"/>` +
  `<path d="M18 162l8-6v12zM302 162l-8-6v12z" fill="#ffffff" fill-opacity="0.7"/>` +
  `</svg>`
