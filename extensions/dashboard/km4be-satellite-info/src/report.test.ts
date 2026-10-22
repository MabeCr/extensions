// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import {
  bodyOf,
  cleanCall,
  cleanGrid,
  defaultCall,
  isCall,
  isGrid,
  labelOf,
  momentOf,
  namesFor,
  parseSatNames,
  problemWith,
  quarterText,
  summaryOf,
  textOf,
} from "./report.ts"
import type { Report } from "./report.ts"
import { FORM } from "./fixtures.ts"

const at = Date.parse("2026-10-22T21:07:30Z")
const report: Report = { name: "AO-7_[U/v]", kind: "heard", at, call: "km4be", grid: "el95VS" }

test("the form's satellites are read from its menu, without the empty first choice or the other menus", () => {
  assert.deepEqual(parseSatNames(FORM), ["AO-123_[FM]", "AO-7_[U/v]", "AO-7_[V/a]", "FO-29_[V/u]", "ISS_[FM]", "ISS_[SSTV]", "ISS_[UHF Digi]"])
  assert.deepEqual(parseSatNames("<html>no form</html>"), [])
  assert.equal(labelOf("AO-7_[U/v]"), "AO-7 [U/v]")
})

test("a satellite's names are the form's, with the transponder of its own kind first", () => {
  const all = parseSatNames(FORM)
  const info = {} as never
  assert.deepEqual(namesFor(all, { name: "AO-7", modulation: "linear", info }), ["AO-7_[U/v]", "AO-7_[V/a]"])
  assert.deepEqual(namesFor(all, { name: "ISS", modulation: "fm", info }), ["ISS_[FM]", "ISS_[SSTV]", "ISS_[UHF Digi]"])
  assert.deepEqual(namesFor(all, { name: "ISS", modulation: "digital", info }), ["ISS_[UHF Digi]", "ISS_[FM]", "ISS_[SSTV]"])
  // The list says ARISS for the station AMSAT calls ISS.
  assert.deepEqual(namesFor(all, { name: "ARISS", modulation: "fm", info: { amsat: ["ISS"] } as never })[0], "ISS_[FM]")
  assert.deepEqual(namesFor(all, { name: "NOT-A-SAT", modulation: "fm", info }), [])
  assert.deepEqual(namesFor(all, { name: "ao-7", modulation: "linear", info }), ["AO-7_[U/v]", "AO-7_[V/a]"], "case does not matter")
})

test("the date and the quarter hour are UTC, two digits each, as the form takes them", () => {
  assert.deepEqual(momentOf(at), { year: "2026", month: "10", day: "22", hour: "21", period: "0" })
  assert.equal(momentOf(Date.parse("2026-01-05T03:15:00Z")).period, "1")
  assert.equal(momentOf(Date.parse("2026-01-05T03:44:59Z")).period, "2")
  assert.deepEqual(momentOf(Date.parse("2026-01-05T03:59:59Z")), { year: "2026", month: "01", day: "05", hour: "03", period: "3" })
  assert.equal(quarterText(at), "21:00–21:15Z")
  assert.equal(quarterText(Date.parse("2026-10-22T21:50:00Z")), "21:45–22:00Z")
  assert.equal(quarterText(Date.parse("2026-10-22T23:50:00Z")), "23:45–00:00Z")
})

test("the body is the form's own fields, in its order, encoded as a form posts them", () => {
  assert.equal(
    bodyOf(report),
    "SatName=AO-7_%5BU%2Fv%5D&SatReport=Heard&SatYear=2026&SatMonth=10&SatDay=22&SatHour=21&SatPeriod=0&SatCall=KM4BE&SatGridSquare=EL95vs&SatSubmit=Submit+Data",
  )
  assert.match(bodyOf({ ...report, kind: "telemetry" }), /SatReport=Telemetry\+Only/)
  assert.match(bodyOf({ ...report, kind: "notHeard" }), /SatReport=Not\+Heard/)
  assert.match(bodyOf({ ...report, grid: "" }), /SatGridSquare=&/)
  assert.match(bodyOf({ ...report, name: "ISS_[UHF Digi]" }), /SatName=ISS_%5BUHF\+Digi%5D&/)
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
