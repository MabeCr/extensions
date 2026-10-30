// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Lines as the nodes in Settings send them, read as spots — and the lines
// around them, which are not spots.

import { test } from "node:test"
import assert from "node:assert/strict"

import { isPromptFor, modeFromComment, nodeProgramFromPrompt, parseSpotLine, spotTime } from "./parse.ts"

const arrived = Date.UTC(2026, 9, 20, 12, 35, 10)

test("a DXSpider spot, with the spotter's grid after the time", () => {
  const spot = parseSpotLine("DX de W3LPL:     14025.0  JA1ABC       CW 599                         1234Z FN20", arrived)
  assert.deepEqual(spot, {
    their: { call: "JA1ABC" },
    freq: 14025,
    band: "20m",
    mode: "CW",
    spot: {
      timeInMillis: Date.UTC(2026, 9, 20, 12, 34),
      source: "cluster",
      label: "CW 599",
      sourceInfo: { spotter: "W3LPL", comments: "CW 599", spotterLocation: "FN20" },
    },
  })
})

test("a skimmer spot, from AR-Cluster with the spotter's state, and the bell and carriage return a node can leave on", () => {
  const spot = parseSpotLine("\x07DX de KM3T-#:    14021.0  OH2BH        CW 17 dB 25 WPM CQ             1234Z MA\r", arrived)
  assert.equal(spot?.their.call, "OH2BH")
  assert.equal(spot?.mode, "CW")
  assert.deepEqual(spot?.spot.sourceInfo, { spotter: "KM3T-#", comments: "CW 17 dB 25 WPM CQ", spotterLocation: "MA" })
})

test("a spot with no comment is labelled by its spotter, and takes its mode from the band plan", () => {
  const spot = parseSpotLine("DX de VE7CC:      7074.0  ZL2ABC                                       1234Z", arrived)
  assert.equal(spot?.spot.label, "de VE7CC")
  assert.equal(spot?.mode, "FT8")
  assert.deepEqual(spot?.spot.sourceInfo, { spotter: "VE7CC" })
})

test("the comment's mode beats the band plan's", () => {
  assert.equal(parseSpotLine("DX de K1TTT:     14080.0  K1ABC        ft8 -12 dB 1234 Hz             1234Z", arrived)?.mode, "FT8")
  assert.equal(parseSpotLine("DX de K1TTT:     14200.0  K1ABC        USB up 5                       1234Z", arrived)?.mode, "SSB")
  assert.equal(modeFromComment("POTA US-1234 QRV"), undefined)
  assert.equal(modeFromComment("FM19 grid, CW"), "CW", "a grid starting with FM is not FM")
})

test("where the band plan names no mode, the band's usual one", () => {
  assert.equal(parseSpotLine("DX de N2ABC:      7225.0  W1AW         59 in NJ                       1234Z", arrived)?.mode, "SSB", "the US phone segment above 7.2 MHz")
  assert.equal(parseSpotLine("DX de 3V8LL:      1847.0  IZ1NER                                      1234Z", arrived)?.mode, "CW")
  assert.equal(parseSpotLine("DX de N2ABC:      5357.0  K1ABC        ft8                            1234Z", arrived)?.mode, "FT8", "the comment still comes first")
  assert.equal(parseSpotLine("DX de N2ABC:    146520.0  K1ABC        simplex                        1234Z", arrived)?.mode, "FM")
})

test("the node program, from the prompt the session's call is shown", () => {
  assert.equal(nodeProgramFromPrompt("KI2D de K3LR 21-Oct 1842Z arc6>"), "AR-Cluster")
  assert.equal(nodeProgramFromPrompt("KI2D de W3LPL 21-Oct-2026 1741Z dxspider >"), "DXSpider")
  assert.equal(nodeProgramFromPrompt("KI2D de VE7CC-1 21-Oct-2026 1741Z   CCC >\r"), "CC Cluster")
  assert.equal(nodeProgramFromPrompt("KI2D de MYNODE 21-Oct-2026 1741Z >"), undefined, "a program it does not know")

  assert.equal(isPromptFor("KI2D de VE7CC-1 21-Oct-2026 1741Z   CCC >\r", "ki2d"), true)
  assert.equal(isPromptFor("KI2D de MYNODE 21-Oct-2026 1741Z >", "KI2D"), true)
  assert.equal(isPromptFor("N2ABC de K3LR 21-Oct 1842Z arc6>", "KI2D"), false, "someone else's, quoted")
  assert.equal(isPromptFor("DX de W3LPL:     14025.0  JA1ABC       CW 599                         1234Z", "KI2D"), false)
})

test("a microwave spot whose frequency crowds the spotter's colon, and a call with a portable designator", () => {
  const spot = parseSpotLine("DX de G4ABC-12:10368100.0 f/ea8xyz/p   tnx QSO                        0915Z IO91", arrived)
  assert.equal(spot?.their.call, "F/EA8XYZ/P")
  assert.equal(spot?.freq, 10368100)
  assert.equal(spot?.band, "3cm")
  assert.equal(spot?.mode, undefined, "nothing says what mode, above where the band plan reaches")
})

test("a comment that quotes another time leaves the spot's own time alone, and a full comment can run into it", () => {
  assert.equal(parseSpotLine("DX de N2ABC:     21300.0  VP8XYZ       QSX 1830Z listening up         1234Z", arrived)?.spot.timeInMillis, Date.UTC(2026, 9, 20, 12, 34))
  const full = parseSpotLine("DX de N2ABC:     21300.0  VP8XYZ       QSX up 5 strong into NA tonight1234Z", arrived)
  assert.equal(full?.spot.label, "QSX up 5 strong into NA tonight")
})

test("a comment that ENDS on a time, with nothing after the spot's own, still leaves the spot its time", () => {
  const spot = parseSpotLine("DX de N2ABC:     21300.0  VP8XYZ       QRV again at 1830Z             1234Z", arrived)
  assert.equal(spot?.spot.timeInMillis, Date.UTC(2026, 9, 20, 12, 34))
  assert.equal(spot?.spot.label, "QRV again at 1830Z")
  assert.equal(spot?.spot.sourceInfo?.spotterLocation, undefined)
})

test("a node that adds both a grid and a state after the time", () => {
  const spot = parseSpotLine("DX de K1TTT:     14025.0  JA1ABC       CW                             1234Z FN42 MA", arrived)
  assert.equal(spot?.their.call, "JA1ABC")
  assert.equal(spot?.spot.sourceInfo?.spotterLocation, "FN42 MA")
})

test("what the node says besides spots is not a spot", () => {
  for (const line of [
    "KI2D de K3LR 20-Oct-2026 1234Z >",
    "To ALL de W1AW: QST bulletin follows",
    "WWV de W0MU <12>:   SFI=150, A=5, K=1, No Storms -> No Storms",
    "WCY de DK0WCY-1 <12> : K=1 expK=2 A=5 R=100 SFI=150 SA=qui GMF=qui Au=no",
    "Hello Sebastian, this is K3LR in Pennsylvania",
    "  14025.0 JA1ABC      20-Oct-2026 1234Z  CW 599                 W3LPL",
    "21-Oct-2026   12   121   8   2 No Storms -> Minor w/G1               <VE7CC>",
    " 14074.0  K2ZJ        21-Foo-2026 1741Z  FT8 -14dB 2640Hz             <EA4HOS-1>",
    "DX de W3LPL:     14025.0  TEST         just checking                  1234Z",
    "DX de W3LPL:         0.0  JA1ABC       no frequency                   1234Z",
    "DX de W3LPL:     14025.0  A1           a prefix, not a call           1234Z",
    "DX de W3LPL:     14025.0  K/1          nor this                       1234Z",
    "",
  ]) {
    assert.equal(parseSpotLine(line, arrived), undefined, line)
  }
})

test("a spot listed by SH/DX, as DXSpider, AR-Cluster and CC Cluster each list one, dated in full", () => {
  const dxspider = parseSpotLine("  28023.0 AD5QU       21-Oct-2026 1741Z A very good qso ARMAN 73      <LW5DD>", arrived)
  assert.deepEqual(dxspider, {
    their: { call: "AD5QU" },
    freq: 28023,
    band: "10m",
    mode: "CW",
    spot: {
      timeInMillis: Date.UTC(2026, 9, 21, 17, 41),
      source: "cluster",
      label: "A very good qso ARMAN 73",
      sourceInfo: { spotter: "LW5DD", comments: "A very good qso ARMAN 73" },
    },
  })

  const arCluster = parseSpotLine(" 24891.0  S9R         21-Oct-2026 1741Z  QSX 24894.70 No RX, (led qrm?)<VU2TMP>", arrived)
  assert.equal(arCluster?.their.call, "S9R")
  assert.equal(arCluster?.spot.label, "QSX 24894.70 No RX, (led qrm?)", "a full comment runs into the spotter")
  assert.equal(arCluster?.spot.sourceInfo?.spotter, "VU2TMP")

  const ccCluster = parseSpotLine("  3573.0  DL1HTW      21-Oct-2026 1617Z  FT8 +06dB from JO51 1395H <SQ9KWY>\r", arrived)
  assert.equal(ccCluster?.mode, "FT8")
  assert.equal(ccCluster?.spot.timeInMillis, Date.UTC(2026, 9, 21, 16, 17))

  const skimmer = parseSpotLine(" 14090.0  IK3UGK      21-Oct-2026 1741Z  RTTY 13 dB 45 BPS CQ         <CT1EYQ-#>", arrived)
  assert.equal(skimmer?.mode, "RTTY")
  assert.equal(skimmer?.spot.sourceInfo?.spotter, "CT1EYQ-#")

  const bare = parseSpotLine(" 21246.0  EC6DX       21-Oct-2026 1739Z                               <KE2DC>", arrived)
  assert.equal(bare?.spot.label, "de KE2DC")
  assert.deepEqual(bare?.spot.sourceInfo, { spotter: "KE2DC" })
})

test("a spot's time is the day it arrived, or the day before across midnight", () => {
  assert.equal(spotTime("1234", arrived), Date.UTC(2026, 9, 20, 12, 34))
  assert.equal(spotTime("2359", Date.UTC(2026, 9, 21, 0, 1)), Date.UTC(2026, 9, 20, 23, 59))
  assert.equal(spotTime("1240", arrived), Date.UTC(2026, 9, 20, 12, 40), "a node clock a few minutes ahead is still today")
  assert.equal(spotTime("2575", arrived), arrived, "no such time, so when it arrived")
})
