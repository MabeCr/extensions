# KM4BE Satellite Info 0.4.3

Orbit data now lives in the app's own offline data, so it survives a restart and CelesTrak is asked only every few days.

## Changed

- **The satellites and their orbits are the app's offline data.** The app downloads the satellite list and CelesTrak's orbits itself, keeps them on the device, and refreshes them when they are old: the orbits after three days, the list after a week. They show up in the app's Offline Data settings. Before, the extension fetched them itself and could keep them only until the app was closed, so every start downloaded the orbits again. That is a lot of requests to CelesTrak, which blocks connections that ask too often.
- **Three days is enough.** Satellite orbits drift by only a kilometer or two a day, which moves a pass by well under a minute.
- **The first start waits for the download.** Until the app has the satellite list, the pane says "No satellite data yet" and fills in on its own, a few seconds after the data arrives.
- **"Orbits are … old"** is judged from when CelesTrak made the orbits, and appears when they are a week old.

## Still true from 0.4.2

- It does not tune or control a radio yet.
- Not every satellite on the list has public orbit data, so some are listed with frequencies but no passes.
- If CelesTrak refuses your connection, the app cannot download orbits until it stops, and the list shows frequencies but no passes.
- Reports you send go to AMSAT's public status page, only when you confirm them.

Feedback and corrections are welcome. Please reach out to KM4BE with suggestions!
