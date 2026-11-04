**KM4BE Satellite Info** puts amateur radio satellites in one place: when they pass over you, where they are in the sky, what to tune to, and whether anyone has been hearing them lately. Add it as a panel and keep it beside your log.

## What it does

- **Pass list.** The next 24 hours of passes for your location, soonest first, with each satellite's transponder type (FM, linear or digital), start time, maximum elevation, path across the sky and length. A line over the list says which satellite is up now and which is next. Star the satellites you follow, and switch between All, Favorites and Up Now. Your stars and the view you chose are remembered.
- **Up Now.** A picture of the sky above you with every satellite that is above the horizon right now, where it really is. Tap one to open its pass.
- **Sky chart.** Open a pass for a polar plot of its path, with rise, peak and set times to the second. While the satellite is overhead you see it move, with its elevation and the Doppler shift beside it. Drag a finger across the chart (or move the mouse over it) to step through the pass and see the frequencies to tune to and send on at any moment, even for a pass that has not started yet.
- **Radio page.** Uplink and downlink frequencies with the Doppler-corrected figures for now, the peak and the set, the access tone and beacon for the satellites that have one, and links to each satellite's own page.
- **AMSAT status.** A coloured mark on each row (green heard, amber telemetry only, red not heard) from operators' reports to AMSAT's status page over the last day, or a window you choose. The mark follows what most reports say, so one bad pass does not undo thirty good ones.
- **Report to AMSAT.** The Report page on a pass lets you tell AMSAT what you heard: pick the transponder, say Heard, Telemetry only or Not heard, and confirm. AMSAT answers whether it took the report, and the pane shows its answer.

## Settings

Minimum elevation, a grid square to use when the device cannot give its location, the AMSAT report window, whether times start in UTC, spacing, seconds in the pass list, the size of the sky chart, and an optional countdown to rise, peak and set.

## Your location and your privacy

It uses your device's location, and falls back to a grid square you type in, then to the operation's grid. Nothing about you is sent anywhere, apart from a report you choose to send to AMSAT. That report is public on AMSAT's status page and carries the satellite, what you heard, the time to the quarter hour, your callsign and, if you left one in, your grid square. Everything else the extension does is download.

## Where the data comes from

- **Satellites and frequencies:** Ham2K's satellite list.
- **Orbits:** CelesTrak's amateur radio group, kept by the app as offline data and refreshed when old.
- **Status reports:** AMSAT's status service, at status.amsat.org. Report data is © AMSAT, shared under CC BY 4.0.

Passes are worked out on your device with SGP4 ([satellite.js](https://github.com/shashwatak/satellite-js), MIT), so they are as good as the orbit and your device's clock.

## Known limits

- Not every satellite on the list has public orbit data. Those are listed with their frequencies, but no passes can be shown.
- A day-old orbit and a clock a second out are each worth about a hundred hertz of Doppler at 435 MHz and a few seconds of timing.
- It shows information only. It does not tune or control a radio.
- Frequencies, tones and beacons come from AMSAT's published pages and can change. Whether a transponder is switched on is not recorded here.

Feedback and corrections are welcome, especially satellite data that is out of date. Please reach out to KM4BE with suggestions.
