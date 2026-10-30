# KM4BE Spot Maps 0.2.0

The map scrolls and zooms like a map, shows every spot your app has instead of POTA alone, and can put a station in your log.

## What is new

- **A map you scroll.** Drag the map east and west and it moves with your finger. To zoom, drag along the strip at the bottom of the map, or tap the plus and minus buttons. How far you can zoom depends on how tall the pane is: the whole height of the map always fits, so a phone held upright zooms to about three times. The Region dropdown still jumps to a part of the world.
- **It opens where you are.** If your operation has a grid square, the map opens zoomed in on your side of the world. If not, it shows the whole world.
- **Every spot the app has.** The stations come from the app's own spot board, the one the Spots panel shows, from every source you have set up: POTA, SOTA, WWFF and the rest. A station gets a dot if the app knows where its reference is, so a station at a park or a summit has a dot and a plain DX cluster spot does not. The line over the map says how many stations have no place. Two settings choose between everything on the board and only what the Spots panel is set to show, and how old the newest spots may be.
- **Tap a dot, then Use in the log.** Tapping a dot picks the station and says who it is, what it is on and how long ago it was spotted. Use in the log puts its call, frequency, band, mode and reference in the logging fields of the operation in front, and tunes your radio, just as a tap on a spot in the Spots panel does. A station you have already worked is drawn fainter.

## Changed

- **The map no longer fetches anything itself.** It used to ask POTA for its spots every minute, with an update interval and a Refresh button. Now the app tells the map when its board changes, so those two are gone, and so is the Station dropdown: tap the dot instead.
- **It asks for permission to control your radio**, because Use in the log tunes it. It does nothing with the radio otherwise.

Feedback and corrections are welcome. Please reach out to KM4BE with suggestions!
