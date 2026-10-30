// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import {
  errorText,
  cleanCall,
  cleanGrid,
  defaultCall,
  isCall,
  isGrid,
  labelOf,
  namesFor,
  parseCatalog,
  payloadOf,
  problemWith,
  quarterText,
  reportedAt,
  summaryOf,
  textOf,
} from "./report.ts"
import type { Report } from "./report.ts"
import { CATALOG } from "./fixtures.ts"

const at = Date.parse("2026-10-22T21:07:30Z")
const report: Report = { name: "AO-7_[U/v]", kind: "heard", at, call: "km4be", grid: "el95VS" }

test("the satellites are read from AMSAT's catalog, as it names them", () => {
  assert.deepEqual(parseCatalog(CATALOG), ["AO-123_[FM]", "AO-7_[U/v]", "AO-7_[V/a]", "FO-29_[V/u]", "ISS_[FM]", "ISS_[SSTV]", "ISS_[UHF_Digi]"])
  // Anything that is not the catalog is no satellites, and nothing is named twice or without a name.
  for (const odd of [null, undefined, {}, { data: "no" }, { data: [{ name: " " }, {}, null] }, "<html>a web page</html>"]) assert.deepEqual(parseCatalog(odd), [])
  assert.deepEqual(parseCatalog({ data: [{ name: "AO-7_[U/v]" }, { name: "AO-7_[U/v]" }] }), ["AO-7_[U/v]"])
  assert.equal(labelOf("AO-7_[U/v]"), "AO-7 [U/v]")
  assert.equal(labelOf("ISS_[UHF_Digi]"), "ISS [UHF_Digi]")
})

test("a satellite's names are AMSAT's, with the transponder of its own kind first", () => {
  const all = parseCatalog(CATALOG)
  const info = {} as never
  assert.deepEqual(namesFor(all, { name: "AO-7", modulation: "linear", info }), ["AO-7_[U/v]", "AO-7_[V/a]"])
  assert.deepEqual(namesFor(all, { name: "ISS", modulation: "fm", info }), ["ISS_[FM]", "ISS_[SSTV]", "ISS_[UHF_Digi]"])
  assert.deepEqual(namesFor(all, { name: "ISS", modulation: "digital", info }), ["ISS_[UHF_Digi]", "ISS_[FM]", "ISS_[SSTV]"])
  // The list says ARISS for the station AMSAT calls ISS.
  assert.deepEqual(namesFor(all, { name: "ARISS", modulation: "fm", info: { amsat: ["ISS"] } as never })[0], "ISS_[FM]")
  assert.deepEqual(namesFor(all, { name: "NOT-A-SAT", modulation: "fm", info }), [])
  assert.deepEqual(namesFor(all, { name: "ao-7", modulation: "linear", info }), ["AO-7_[U/v]", "AO-7_[V/a]"], "case does not matter")
})

test("a report's time is the start of its quarter hour, in UTC, as the API takes it", () => {
  assert.equal(reportedAt(at), "2026-10-22T21:00:00Z")
  assert.equal(reportedAt(Date.parse("2026-01-05T03:15:00Z")), "2026-01-05T03:15:00Z")
  assert.equal(reportedAt(Date.parse("2026-01-05T03:44:59Z")), "2026-01-05T03:30:00Z")
  assert.equal(reportedAt(Date.parse("2026-12-31T23:59:59Z")), "2026-12-31T23:45:00Z")
  assert.equal(reportedAt(Date.parse("2027-01-01T00:00:00Z")), "2027-01-01T00:00:00Z")
  assert.equal(quarterText(at), "21:00–21:15Z")
  assert.equal(quarterText(Date.parse("2026-10-22T21:50:00Z")), "21:45–22:00Z")
  assert.equal(quarterText(Date.parse("2026-10-22T23:50:00Z")), "23:45–00:00Z")
})

test("what is sent is the API's own fields, as JSON, with the grid left out when there is none", () => {
  assert.deepEqual(payloadOf(report), { name: "AO-7_[U/v]", report: "Heard", callsign: "KM4BE", grid_square: "EL95vs", reported_at: "2026-10-22T21:00:00Z" })
  assert.equal(payloadOf({ ...report, kind: "telemetry" }).report, "Telemetry Only")
  assert.equal(payloadOf({ ...report, kind: "notHeard" }).report, "Not Heard")
  assert.ok(!("grid_square" in payloadOf({ ...report, grid: "" })), "not sent empty")
  assert.ok(!("grid_square" in payloadOf({ ...report, grid: "  " })))
  assert.equal(payloadOf({ ...report, name: "ISS_[UHF_Digi]" }).name, "ISS_[UHF_Digi]", "the name is AMSAT's own, untouched")
  assert.equal(payloadOf({ ...report, call: " w8abe " }).callsign, "W8ABE")
})

test("a refusal is said in AMSAT's own words, and without them as what came back", () => {
  assert.equal(errorText(422, JSON.stringify({ error: { code: "invalid_parameter", message: "callsign is required", status: 422 } })), "AMSAT did not take it: callsign is required (HTTP 422)")
  assert.equal(errorText(400, JSON.stringify({ message: "Bad request" })), "AMSAT did not take it: Bad request (HTTP 400)")
  assert.equal(errorText(503, ""), "AMSAT did not take it (HTTP 503).")
  assert.equal(errorText(502, "<html><body><h1>Bad Gateway</h1></body></html>"), "AMSAT did not take it (HTTP 502): Bad Gateway.")
  assert.equal(errorText(500, JSON.stringify({ error: {} })), "AMSAT did not take it (HTTP 500): {\"error\":{}}.")
  assert.ok(errorText(422, JSON.stringify({ error: { message: "x".repeat(500) } })).length < 220, "a long message is cut")
})

test("callsigns and grids are tidied before they are checked", () => {
  assert.equal(cleanCall("  km4be "), "KM4BE")
  assert.equal(cleanGrid(" el95VS "), "EL95vs")
  assert.equal(cleanGrid("el95"), "EL95")
  for (const ok of ["KM4BE", "W1AW", "VE3BEP", "2E0ABC", "K4MBE/P", "KH6/W1AW", "w1aw"]) assert.ok(isCall(ok), ok)
  for (const bad of ["", "WHISKEY", "KM4", "4", "KM 4 BE!", "///"]) assert.ok(!isCall(bad), bad)
  for (const ok of ["EL95", "EL95vs", "el95vs", "FN31pr", "JO22hd11"]) assert.ok(isGrid(ok), ok)
  for (const bad of ["", "E", "ZZ99", "EL9", "EL95v", "EL95zz"]) assert.ok(!isGrid(bad), bad)
})

test("the operator's callsign is the default: the operator's, else the station's, upper case", () => {
  assert.equal(defaultCall({ operatorCall: "km4be", stationCall: "W1AW" }), "KM4BE")
  assert.equal(defaultCall({ stationCall: "w1aw" }), "W1AW")
  assert.equal(defaultCall({ operatorCall: "  ", stationCall: "W1AW" }), "W1AW")
  assert.equal(defaultCall({}), "")
  assert.equal(defaultCall(undefined), "")
  assert.equal(defaultCall({ operatorCall: 5 }), "")
})

test("what is missing is said, one thing at a time, and an empty grid is fine", () => {
  const ok = { name: "AO-7_[U/v]", kind: "heard" as const, call: "KM4BE", grid: "EL95vs" }
  assert.equal(problemWith(ok), "")
  assert.equal(problemWith({ ...ok, grid: "" }), "")
  assert.match(problemWith({ ...ok, name: "" }), /transponder/)
  assert.match(problemWith({ ...ok, kind: "" }), /what you heard/)
  assert.match(problemWith({ ...ok, call: " " }), /Enter your callsign/)
  assert.match(problemWith({ ...ok, call: "banana" }), /BANANA does not look like a callsign/)
  assert.match(problemWith({ ...ok, grid: "ZZ" }), /not a grid square/)
})

test("the summary says everything that will be sent", () => {
  assert.equal(summaryOf(report), "AO-7 [U/v]: heard, 21:00–21:15Z, as KM4BE, EL95vs")
  assert.equal(summaryOf({ ...report, kind: "notHeard", grid: "" }), "AO-7 [U/v]: not heard, 21:00–21:15Z, as KM4BE, no grid")
})

test("a page is read as its words", () => {
  assert.equal(textOf("<html><style>p{}</style><body><p>Thank&nbsp;you</p><script>x()</script><b>KM4BE</b></body>"), "Thank you KM4BE")
})
