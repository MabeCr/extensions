# KM4BE Satellite Info 0.4.2

The list is there when you first open it, instead of needing you to leave the tab and come back.

## Fixed

- **A first draw that came up empty.** Opening the list right after the app starts could show nothing until the pane was drawn again, which switching to another tab and back does. Several things could cause it, and all of them are dealt with:
  - Your position, the list of satellites, their orbits and AMSAT's reports were asked for one after another, so a slow phone position or a slow server held up everything behind it. They are now asked for together, and each web request gives up after eight seconds.
  - If your position was not ready the first time, the list said "No location" and kept saying it for a minute even after the position arrived. It now looks again within a few seconds, and if the position goes missing for a moment it uses the last one.
  - A list that is waiting for its satellites, or for your position, now draws itself again every few seconds on its own until they arrive.
  - If the app thought it was offline just after starting, nothing was asked for. With nothing to show yet, it now tries anyway.
  - A pane that was briefly measured as only a sliver wide while the app was laying it out could produce a list the app refuses to draw. The list is now laid out for no less than a phone's narrowest width.

## Still true from 0.4.1

- It does not tune or control a radio yet.
- Not every satellite on the list has public orbit data, so some are listed with frequencies but no passes.
- Reports you send go to AMSAT's public status page, only when you confirm them.

Feedback and corrections are welcome. Please reach out to KM4BE with suggestions!
