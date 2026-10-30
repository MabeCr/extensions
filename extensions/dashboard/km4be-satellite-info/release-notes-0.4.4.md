# KM4BE Satellite Info 0.4.4

Orbits now come through Ham2K's caching proxy instead of straight from CelesTrak.

## Changed

- **Orbits are downloaded through services.ham2k.net.** CelesTrak asks apps not to request the same data often and blocks connections that do. Ham2K's proxy asks CelesTrak once and serves everyone, so your phone no longer talks to CelesTrak at all, and a block on your connection cannot stop the list from loading. It is the same data: the same orbits, kept for three days by the app.

## Still true from 0.4.3

- The satellite list and the orbits are the app's offline data: they survive a restart and show in the app's Offline Data settings.
- It does not tune or control a radio yet.
- Not every satellite on the list has public orbit data, so some are listed with frequencies but no passes.
- Reports you send go to AMSAT's public status page, only when you confirm them.

Feedback and corrections are welcome. Please reach out to KM4BE with suggestions!
