# KM4BE Satellite Info 0.3.0

A round of changes to make the pass list easier to read at a glance, and a pass's Radio page keep up with the satellite.

**This version needs a Ham2K Logger new enough for extension API 12.** An older app refuses to install it, so stay on 0.2.1 until you update the app.

## What is new

- **What is up, and what is next.** The line over the list now says which satellite is overhead and how long it has left, and which comes next and when: "AO-7 up now, 5 min left · Next: SO-50 in 12 min". A pass that is up is drawn in green in the list. The note about how old the orbits are now shows only when they are, which is when the connection has been down for half a day.
- **Report marks you can read.** What AMSAT's reports say of each satellite is a coloured icon at the end of its row, green for heard, amber for telemetry only, red for not heard, and the key under the list uses the same icons. Before, the marks were characters that came out in different sizes. The Rpt column no longer takes room from the rest of the line, so more of it fits at a larger size. In a wide pane the icons stay beside their rows.
- **The Radio page keeps up.** While the satellite is overhead, the Doppler-corrected frequencies on a pass's Radio page are redrawn every two seconds, as the sky plot is, so the figure for now is for now.
- **A tab that reads whole.** The pane's tab says Satellites, not "KM4BE Sa…".
- **A picture in the list of panels.** The panel shows a small picture of a sky plot and a list where the app lists panels you can add.

## Still true from 0.2.1

- It does not tune or control a radio yet.
- Not every satellite on the list has public orbit data, so some are listed with frequencies but no passes.
- Reports you send go to AMSAT's public status page, only when you confirm them.

Feedback and corrections are welcome. Please reach out to KM4BE with suggestions!
