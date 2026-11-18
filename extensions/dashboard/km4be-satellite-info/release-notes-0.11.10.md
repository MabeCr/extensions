# KM4BE Satellite Info 0.11.10

A quicker map, long text that wraps, and Radio and Report pages that scroll.

This replaces 0.11.1 to 0.11.9.

## Fixed

- **A long pass that was already up showed the wrong rise.** Opening a pass that had been under way for more than half an hour, such as an IO-117 pass, showed its "Rise" as the moment the list was worked out, with the satellite already at 44° and the peak a second later. The pass is now traced back to where the satellite really rose, however long ago, so the rise time and bearing, the whole path on the sky chart and the true peak are shown.

## Earlier in this series

- **The track shows only for a near pass.** On the Map tab the dashed track runs from the satellite's ringed dot to where the pass begins, but only when the pass is within about two hours. For a later pass, which would only be a long scribble across the map, it is left out. Nothing is drawn after the red end dot.

- **A quicker map.** The Map tab was slow to pan and zoom on a phone. It now leaves off the state and province lines, the grid and the night shading, and the satellite's dot moves every 5 seconds instead of every second, so the app redraws the map less while you move it. A new **Map detail** setting, Fast or Full, puts the state lines, grid and night shading back.

- **The app breaks the lines.** A text that might be too long for the pane is now laid out as words that the app itself wraps where they reach the edge, so lines fill the width and none is cut off, whatever the font and text size.
- **Text no longer runs off the side.** On a pass's Radio page, a line too long for the pane, such as the transponder's notes (SO-50's "Arm first…" line), the Doppler, rotator and contact lines or an AMSAT report, now goes onto the next line instead of being cut off with "...". The caption under the map and the lines on the Report page do the same. A narrow pane, like a phone, breaks lines sooner.
- **Scrolling in landscape.** The Radio and Report pages now scroll, so a phone held on its side can reach everything on them.

## Still true from 0.11.0

- Band Scope labels, pass alerts, logging contacts via the satellite, rotator tracking, Doppler tracking, the Map tab and smoother live updates.
- Needs a Ham2K Logger that speaks extension API 25 or later.

Feedback and corrections are welcome. Please reach out to KM4BE with suggestions!
