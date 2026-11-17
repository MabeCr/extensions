# KM4BE Satellite Info 0.7.0

Smoother live updates.

## Changed

- **The satellite moves every second, not every two.** On the Sky page while a satellite is up, and on the Map page, only what moves is sent to the pane: the satellite, the elevation and heading, the Doppler readout, and on the map the satellite's dot and footprint. The rest of the page is drawn again only every 10 seconds (30 on the map), which is lighter on the app and the battery.
- **The Doppler tracking line on the Sky page** keeps up with the radio every second too.

## Still true from 0.6.0

- The Map tab shows the pass's ground track, where the satellite is now and where it can be heard from.
- Doppler tracking keeps your radio on the downlink, and the uplink on a second receiver if you name one.
- Needs a Ham2K Logger that speaks extension API 25 or later.

Feedback and corrections are welcome. Please reach out to KM4BE with suggestions!
