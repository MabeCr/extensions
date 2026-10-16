// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// A live preview of an extension's panels in a browser, for iterating on how
// they look without a device:
//
//   node scripts/preview-panels.mjs extensions/dashboard/ki2d-solar-panel [port]
//
// It builds the extension with its own build script, evaluates the bundle
// against a working stand-in for the kernel (the real shared libraries, a
// fetch that reaches the network, a sheet that shows forms), and renders every
// panel it registers at several pane sizes in light and dark. A change under
// the extension's `src/` or to its manifest rebuilds and re-renders; the page
// picks it up by itself. Sliders inspect on hover and buttons send their
// events to the panel, as in the app.
//
// It is not the host. Text is laid out by the browser, not Flutter, and the
// colors and type are a Material approximation rather than the app's theme,
// so a pixel-level question still needs a device. Upstream responses are
// cached on disk for 15 minutes, so re-renders are instant and polite.
//
// Optional `preview.json` beside the manifest adds cases to the default grid:
//
//   {
//     "defaults": { "operation": { "grid": "FN30" }, "qso": { "freq": 14074, "band": "20m" } },
//     "cases": [{ "config": { "theme": "teal" } }, { "qso": { "freq": 7074 }, "app": "dark", "width": 300, "height": 260 }]
//   }
//
// A case may set `panel`, `config`, `operation`, `qso`, `qsos` (what
// `ctx.getQsos` answers), `readings` (the live radio values a scene with
// `radio` is fed, as `{"radio.transmitting": 1, "radio.swr": 1.4}`), `app`
// (the app's brightness), `locale`, `width`, `height` and `label`. SIZES (`360x520,220x150`) and LOCALES (`en,es`) in the
// environment replace the default grid.

import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { watch } from "node:fs"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createContext, runInContext } from "node:vm"

const [input, port = "4417"] = process.argv.slice(2)
if (!input) {
  console.error("Usage: node scripts/preview-panels.mjs <extension dir> [port]")
  process.exit(2)
}
const ext = resolve(input)
const page = join(import.meta.dirname, "preview-panels.html")
const manifest = () => readFile(join(ext, "manifest.json"), "utf8").then(JSON.parse)
const cacheDir = join(tmpdir(), "ham2k-panel-preview", (await manifest()).key)
await mkdir(cacheDir, { recursive: true })

const CACHE_MILLIS = 15 * 60000
const typo = (fontSize, lineHeight, fontWeight = 400) => ({
  fontFamily: "Roboto", fontFamilyFallback: [], fontSize, scaledFontSize: fontSize, fontWeight, lineHeight, letterSpacing: 0,
})
const typography = { body: typo(14, 1.43), label: typo(12, 1.33, 500), title: typo(16, 1.5, 500), display: typo(36, 1.22), mono: { ...typo(13, 1.4), fontFamily: "RobotoMono" } }
/// Material 3 schemes seeded from the app's teal (#006783).
const colors = {
  light: { surface: "#f5fafc", surfaceContainer: "#e9eff1", onSurface: "#171c1f", onSurfaceVariant: "#40484c", accent: "#006783", primary: "#006783", onPrimary: "#ffffff", secondary: "#4c626a", outline: "#70787d", outlineVariant: "#c0c8cc", error: "#ba1a1a", onError: "#ffffff" },
  dark: { surface: "#0f1416", surfaceContainer: "#1b2023", onSurface: "#dee3e6", onSurfaceVariant: "#c0c8cc", accent: "#86d1ec", primary: "#86d1ec", onPrimary: "#003545", secondary: "#b3cad3", outline: "#8a9296", outlineVariant: "#40484c", error: "#ffb4ab", onError: "#690005" },
}

async function cachedFetch(url, options = {}) {
  const method = (options.method ?? "GET").toUpperCase()
  const file = join(cacheDir, createHash("sha1").update(url).digest("hex"))
  if (method === "GET") {
    try {
      if (Date.now() - (await stat(file)).mtimeMs < CACHE_MILLIS) return JSON.parse(await readFile(file, "utf8"))
    } catch {}
  }
  const response = await fetch(url, { method, headers: options.headers, body: options.body, signal: AbortSignal.timeout(options.timeout ?? 15000) })
  const answer = { status: response.status, body: await response.text(), headers: Object.fromEntries(response.headers) }
  if (method === "GET" && response.status === 200) await writeFile(file, JSON.stringify(answer))
  return answer
}

/// Each load is a fresh context, so a rebuilt bundle starts from clean module state.
async function loadExtension() {
  await new Promise((done, fail) => {
    const child = spawn(process.execPath, ["build.mjs"], { cwd: ext, stdio: ["ignore", "ignore", "pipe"] })
    let errors = ""
    child.stderr.on("data", data => { errors += data })
    child.on("exit", code => code ? fail(new Error(`build failed\n${errors}`)) : done())
  })
  const definition = await manifest()
  const sharedModules = {}
  for (const name of Object.keys(definition.sharedDependencies ?? {})) {
    try { sharedModules[name] = await import(name) } catch (error) { console.log(`ERROR shared module ${name}: ${error.message}`); sharedModules[name] = {} }
  }
  const panels = [], store = new Map(), unsupported = new Set()
  // One connected radio, so radio panels have something to show; what a panel sets, it reads back.
  const radio = {
    id: "demo", name: "Demo radio", status: "connected", stale: false, problem: null, frequencyHz: 14074000, mode: "USB",
    powerWatts: 100, maxWatts: 100, transmitting: false, meters: { signalDbm: -85, supplyVolts: 13.8 }, canTune: true,
    tuner: "bypassed", canStartTune: true, passband: { lowHz: 100, highHz: 2800 }, antennas: null, modes: ["LSB", "USB", "CW", "AM", "FM"], keying: null, lastTransmission: null,
  }
  let sheets = []
  const hostCall = async (method, params = {}) => {
    switch (method) {
      case "fetch": return cachedFetch(params.url, params)
      case "kvGet": return store.get(`${params.ns}/${params.key}`) ?? null
      case "kvSet": store.set(`${params.ns}/${params.key}`, params.value); return null
      case "getLocation": return null
      case "getSettings": return {}
      case "listRadios": return [radio]
      case "readRadio": return radio
      case "setRadio": case "tuneRadio":
        for (const key of ["frequencyHz", "mode", "powerWatts", "tuner", "passband"]) if (params[key] !== undefined) radio[key] = params[key]
        return { accepted: true, state: radio }
      case "setRadioConnection": case "setRadioSpectrum": case "sendRadioCw": case "playRadioVoice": case "setRadioPtt": case "stopRadioTransmit":
        return { accepted: true, state: radio }
      case "showMessage": sheets.push({ title: params.title, text: params.text }); return null
      default:
        if (!unsupported.has(method)) { unsupported.add(method); console.log(`HOST ${method} is not stood in for here; answering {}`) }
        return {}
    }
  }
  const sandbox = {
    console, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, AbortSignal, structuredClone, atob, btoa,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
  }
  sandbox.globalThis = sandbox
  sandbox.__polo = {
    sharedModules,
    hostCall,
    log: message => console.log(`LOG ${message}`),
    host: { showForm: async form => { sheets.push(form); return null } },
    defineExtension(def) {
      def.onActivation({
        hostCall,
        registerHook(category, { key, hook }) { if (category === "panel") panels.push({ key, hook }) },
      })
    },
  }
  runInContext(await readFile(join(ext, "build/index.js"), "utf8"), createContext(sandbox))
  return { definition, panels, takeSheets: () => { const shown = sheets; sheets = []; return shown } }
}

async function readCases() {
  let file = {}
  try { file = JSON.parse(await readFile(join(ext, "preview.json"), "utf8")) } catch (error) {
    if (error.code !== "ENOENT") console.log(`ERROR preview.json: ${error.message}`)
  }
  const defaults = file.defaults ?? {}
  const sizes = (process.env.SIZES ?? "360x520,300x260,520x760,220x150").split(",").map(s => s.split("x").map(Number))
  const grid = []
  for (const locale of (process.env.LOCALES ?? "en").split(",")) {
    for (const [width, height] of sizes) for (const app of ["light", "dark"]) grid.push({ width, height, app, locale })
  }
  return [...grid, ...(file.cases ?? [])].map(c => ({
    width: 360, height: 520, app: "light", locale: "en", ...defaults, ...c,
    label: c.label ?? Object.entries(c).filter(([k]) => !["width", "height", "app", "locale"].includes(k)).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(" "),
  }))
}

let loaded, cases = [], results = { rendered: null, results: [] }
/// The demo radio, receiving, long after its last transmission. A case's `readings` replace any of them.
const radioReadings = { "radio.signalDbm": -85, "radio.powerOut": 0, "radio.supplyVolts": 13.8, "radio.transmitting": 0, "radio.secondsSinceTransmit": 1e6 }

function argsFor(c, index, panelKey) {
  const now = Date.now(), environment = {
    version: 1, width: c.width, height: c.height, safeInsets: { left: 0, top: 0, right: 0, bottom: 0 },
    brightness: c.app, colors: colors[c.app], typography, locale: c.locale, textDirection: "ltr", devicePixelRatio: 2, reducedMotion: false, highContrast: false,
  }
  const args = { environment, clock: { nowMillis: now, realNowMillis: now }, instanceId: `case-${index}`, panelKey, operation: c.operation ?? {}, qso: c.qso, qsoCount: c.qsos?.length ?? 0, config: c.config ?? {}, reason: "preview" }
  const ctx = { online: true, locale: c.locale, distanceUnits: "kilometers", getQsos: async () => c.qsos ?? [] }
  return { args, ctx }
}

async function renderCase(c, index) {
  const entries = []
  for (const { key, hook } of loaded.panels) {
    const { args, ctx } = argsFor(c, index, "")
    let descriptors
    try { descriptors = await hook.getPanels({}, ctx) } catch (error) { entries.push({ ...c, index, panel: key, error: String(error?.stack ?? error) }); continue }
    for (const descriptor of descriptors.filter(d => !c.panel || d.key === c.panel)) {
      try {
        const result = await hook.render({ ...args, panelKey: descriptor.key }, ctx)
        // The host feeds a scene that asks for the radio its live readings, with no render between.
        if (result?.scene?.radio) Object.assign(result.scene.values, { ...radioReadings, ...c.readings })
        entries.push({ ...c, index, hook: key, panel: descriptor.key, result })
      } catch (error) {
        entries.push({ ...c, index, hook: key, panel: descriptor.key, error: String(error?.stack ?? error) })
      }
    }
  }
  return entries
}

async function renderAll() {
  const all = []
  for (const [index, c] of cases.entries()) all.push(...await renderCase(c, index))
  results = { rendered: new Date().toISOString(), extension: loaded.definition.key, version: loaded.definition.version, results: all }
  const failures = all.filter(r => r.error)
  console.log(`${results.rendered} rendered ${all.length} panels${failures.length ? `, ${failures.length} ERRORS:\n${failures.map(f => f.error).join("\n")}` : ""}`)
}

let busy = Promise.resolve(), timer
function rebuild() {
  busy = busy.then(async () => {
    try {
      loaded = await loadExtension()
      cases = await readCases()
      await renderAll()
    } catch (error) {
      console.log(`ERROR ${error?.stack ?? error}`)
    }
  })
}
const later = () => { clearTimeout(timer); timer = setTimeout(rebuild, 150) }
watch(join(ext, "src"), { recursive: true }, later)
for (const name of ["manifest.json", "preview.json"]) watch(ext, (_, file) => file === name && later())
rebuild()
// Panels refresh on their own ticks in the app; a minute keeps ages and live data moving here.
setInterval(() => { busy = busy.then(() => loaded && renderAll().catch(error => console.log(`ERROR ${error?.stack ?? error}`))) }, 60000)

/// A control's event, as the host sends it: the panel answers, and the case renders again.
async function sendEvent({ index, hook, panel, controlId, action, phase = "activate", value, text }) {
  await busy
  const c = cases[index]
  const owner = loaded.panels.find(p => p.key === hook && p.hook.onEvent)
  if (!c || !owner) return { sheets: [], entries: [] }
  const { args, ctx } = argsFor(c, index, panel)
  let values = {}
  try {
    values = (await owner.hook.onEvent({ ...args, event: { controlId, action, phase, sequence: Date.now(), value, text } }, ctx))?.values ?? {}
  } catch (error) {
    console.log(`ERROR onEvent ${action}: ${error?.stack ?? error}`)
  }
  await new Promise(done => setTimeout(done, 50)) // a sheet opened without awaiting lands on the next turn
  return { values, sheets: loaded.takeSheets(), entries: await renderCase(c, index) }
}

createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0]
  const json = (status, value) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(value)) }
  try {
    if (path === "/") {
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" })
      return res.end(await readFile(page))
    }
    if (path === "/scenes.json") return json(200, results)
    if (path === "/page-version") return json(200, (await stat(page)).mtimeMs)
    if (path === "/event" && req.method === "POST") {
      let body = ""
      for await (const chunk of req) body += chunk
      return json(200, await sendEvent(JSON.parse(body)))
    }
    json(404, {})
  } catch (error) {
    json(500, { error: String(error) })
  }
}).listen(Number(port), () => console.log(`previewing ${ext} at http://localhost:${port}/`))
