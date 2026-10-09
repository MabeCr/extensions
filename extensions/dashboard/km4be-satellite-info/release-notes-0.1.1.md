# KM4BE Satellite Info 0.1.1

A one-stop pane for working amateur satellites: when they pass over you, where they are in the sky, what to tune to, and whether anyone has been hearing them. This is the first release, so expect rough edges.

## What it does

**Pass list.** The next 24 hours of passes for your location, soonest first, five to a page, with the satellite, start time, maximum elevation, path across the sky, length, and an AMSAT report mark. Star a satellite to follow it, and switch between Favorites and All. A switch flips times between local and UTC.

**A pass's page.** Tap a row to open it.
- **Sky:** a polar plot, north up, with the path, the rise (green), the set (red) and the peak (white), their times to the second, and an arrow showing which way it is going. While the satellite is overhead you see it move across the plot, with its current elevation beside it, and the Doppler shift for the downlink to tune to and the uplink to send on, in kilohertz from nominal.
- **Radio:** uplink and downlink frequencies with Doppler-corrected figures at rise (or now), peak and set; the access tone, beacon and a tip for the satellites where AMSAT publishes them (14 so far, including SO-50's arming tone); and AMSAT's recent status reports.
- **Links:** AMSAT's status page, and each satellite's own page where there is one.

**Status marks.** ✔ heard, ◐ telemetry only, ✘ not heard, from operators' reports to AMSAT over the last 24 hours (you can change the window). The mark follows what most reports say, so one bad pass doesn't undo thirty good ones; the latest report is shown separately on the pass's page.

## Settings

Minimum elevation (default 10°, passes below it are hidden), a grid square to use when the device can't give its location, the AMSAT report window, start in UTC, spacing (Automatic packs the list tighter in a small pane such as a phone), seconds in the pass list, and an optional countdown to rise, peak and set, which redraws the page every second.

## Where your location goes

It uses the device's location, rounded to the middle of its six-character grid square, and falls back to a grid you type in, then to the operation's grid. Nothing about you is sent anywhere: the extension only downloads.

## Where the data comes from

- **Satellite list and frequencies:** Ham2K's list at polo.ham2k.com.
- **Orbits:** CelesTrak's amateur-radio group, refreshed every six hours.
- **Status reports:** AMSAT's status page.

All three are kept on your device, so it keeps working from the last copy if the connection drops. The passes are worked out on your device with SGP4 (satellite.js, MIT).

## Known limits

- **Not every satellite on the list has public orbit data.** At the time of this release, 16 of the 38 satellites did. The rest are listed with their frequencies, but no passes can be shown for them. Some of the list's own NORAD numbers were wrong and are corrected in the extension.
- Pass times are only as good as the orbit and your device's clock. A day-old orbit and a clock a second out are each worth about a hundred hertz of Doppler at 435 MHz and a few seconds of timing.
- It shows information only. It does not tune or control a radio yet. This is planned.
- Frequencies, tones and beacons come from AMSAT's published pages; they can change, and nothing that changes week to week (such as whether a transponder is switched on) is recorded here.

Feedback and corrections are welcome, especially satellite data that is out of date. Please reach out to KM4BE with suggestions!
