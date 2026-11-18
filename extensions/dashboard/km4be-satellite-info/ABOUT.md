**KM4BE Satellite Info** puts amateur radio satellites in one place: when they pass over you, where they are in the sky, what to tune to (and keeping your radio there), and whether anyone has been hearing them lately. Add it as a panel and keep it beside your log.

## What it does

- **Pass list.** The next 24 hours of passes for your location, soonest first, with each satellite's transponder type (FM, linear or digital), start time, maximum elevation, path across the sky and length. A line over the list says which satellite is up now and which is next. Star the satellites you follow, and switch between All, Favorites and Up Now. Your stars and the view you chose are remembered.
- **Up Now.** A picture of the sky above you with every satellite that is above the horizon right now, where it really is. Tap one to open its pass.
- **Sky chart.** Open a pass for a polar plot of its path, with rise, peak and set times to the second. While the satellite is overhead you see it move smoothly, a step every second, with its elevation and compass heading (like "El 45°" and "Az 245° WSW") together in the bottom left corner, and the Doppler shift at the top. Drag a finger across the chart (or move the mouse over it) to step through the pass and see the heading, elevation and frequencies to tune to and send on at any moment, even for a pass that has not started yet.
- **Map.** The Map tab puts the pass on a map of the world: the ground track, solid while the satellite is above your horizon and dashed from where the satellite is now to where the pass begins (when the pass is within about two hours), green where it rises for you and red where it sets, and where it is right now with the circle of ground it can be heard from. Zoom and pan it as you like. The map is kept light so that it moves quickly on a phone, without state lines, the grid or the night shading; a Map detail setting draws them.
- **Radio page.** Uplink and downlink frequencies with the Doppler-corrected figures for now, the peak and the set, the access tone and beacon for the satellites that have one, and links to each satellite's own page.
- **Doppler tracking.** Switch on Track Doppler on a pass's Radio page and the app keeps your logging radio on the satellite's downlink, retuning it every second as the shift changes. Before rise it waits on the frequency the satellite will first be heard on. Tune across a linear transponder and it follows you, keeping the station you found in place. Pick a second receiver (an IC-9700's Sub, or another radio) under "Uplink on", and your transmit frequency is corrected too, through the transponder. It stops on its own after the satellite sets.
- **Rotator tracking.** Switch on Point rotator on the Radio page and the station's rotator turns to where the satellite will rise, then follows it across the sky, a few degrees at a time and aimed a moment ahead. An az/el rotator is given the elevation too. It is left where the satellite set.
- **Log contacts via the satellite.** Switch on "Log contacts via this satellite" on the Radio page and every contact you start during the pass, and for a few minutes after, gets the satellite as its own, as the Satellites activity records it, so your logs and exports say which bird it went through. The contact's other references stay as they are.
- **Pass alerts.** Switch on Pass alerts in the panel's settings and a line under the call info says when a satellite is about to rise, where and how high it will go ("AO-7 rises in 2 min in the NNE, up to 62°"), then where it is while it is up and when it sets. They come even with the panel closed, for every satellite or only your favorites, starting 3 minutes before rise or a lead you choose.
- **On the Band Scope.** Switch on "Label satellites on the band scope" and each satellite that is up, or about to rise, is marked on the Band Scope where you will hear it, "AO-7 ↓" over its downlink, Doppler-corrected and following the shift as the pass goes, with "AO-7 ↑" on its uplink. The marks come off when it sets.
- **AMSAT status.** A coloured mark on each row (green heard, amber telemetry only, red not heard) from operators' reports to AMSAT's status page over the last day, or a window you choose. The mark follows what most reports say, so one bad pass does not undo thirty good ones.
- **Report to AMSAT.** The Report page on a pass lets you tell AMSAT what you heard: pick the transponder, say Heard, Telemetry only or Not heard, and confirm. AMSAT answers whether it took the report, and the pane shows its answer.

## Settings

Minimum elevation, a grid square to use when the device cannot give its location, the AMSAT report window, whether times start in UTC, spacing, seconds in the pass list, the size of the sky chart, an optional countdown to rise, peak and set, the detail of the map, pass alerts and band scope labels, each on or off, both for favorites only if you like, and how many minutes before rise they start.

## Your location and your privacy

It uses your device's location, and falls back to a grid square you type in, then to the operation's grid. Nothing about you is sent anywhere, apart from a report you choose to send to AMSAT. That report is public on AMSAT's status page and carries the satellite, what you heard, the time to the quarter hour, your callsign and, if you left one in, your grid square. Everything else the extension does is download. It asks to control your radio so that Doppler tracking can tune it and the rotator can be pointed; it does either only while you have it switched on, and never transmits. It asks to change the contact you are typing so that it can add the satellite to it, which it does only while that is switched on.

## Where the data comes from

- **Satellites and frequencies:** Ham2K's satellite list.
- **Orbits:** CelesTrak's amateur radio group, kept by the app as offline data and refreshed when old.
- **Status reports:** AMSAT's status service, at status.amsat.org. Report data is © AMSAT, shared under CC BY 4.0.

Passes are worked out on your device with SGP4 ([satellite.js](https://github.com/shashwatak/satellite-js), MIT), so they are as good as the orbit and your device's clock.

## Known limits

- Not every satellite on the list has public orbit data. Those are listed with their frequencies, but no passes can be shown.
- A day-old orbit and a clock a second out are each worth about a hundred hertz of Doppler at 435 MHz and a few seconds of timing.
- Doppler tracking sets frequencies only, and the mode once when it starts (FM for an FM satellite, USB for a linear one). Split, satellite mode and tones are left to your radio's own settings.
- Frequencies, tones and beacons come from AMSAT's published pages and can change. Whether a transponder is switched on is not recorded here.

Feedback and corrections are welcome, especially satellite data that is out of date. Please reach out to KM4BE with suggestions.
