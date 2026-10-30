# KM4BE Satellite Info 0.4.3

Orbit data is kept for days, so the list keeps working when CelesTrak is slow, down or has blocked your connection.

## Changed

- **Orbits are fetched every three days, not every six hours.** Satellite orbits drift by only a kilometer or two a day, which moves a pass by well under a minute, so a copy a few days old is as good as a new one. The app keeps the last copy on your device and uses it until it is three days old. This also means far fewer requests to CelesTrak, which asks apps not to fetch the same data often and blocks connections that do.
- **A server that says no is left alone.** If CelesTrak refuses the request (a 403 or 429), the app waits two hours before asking again, rather than retrying every few seconds and making a block last longer. If it is merely down or slow, the app uses its saved copy and tries again in an hour.
- **The "Orbits are … old" note** now appears when the copy is a week old, not twelve hours.

## Still true from 0.4.2

- It does not tune or control a radio yet.
- Not every satellite on the list has public orbit data, so some are listed with frequencies but no passes.
- On a first run with no saved orbits, a blocked connection still shows no passes until CelesTrak allows requests again.
- Reports you send go to AMSAT's public status page, only when you confirm them.

Feedback and corrections are welcome. Please reach out to KM4BE with suggestions!
