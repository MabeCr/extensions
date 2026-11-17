# KM4BE Satellite Info 0.8.0

Your antenna can now follow the satellite.

## New

- **Rotator tracking.** A Point rotator switch on a pass's Radio page, with the rotator to use beside it, turns the station's rotator to where the satellite will rise and then follows it across the sky. It moves a few degrees at a time, aimed a couple of seconds ahead so a slow rotator keeps up. An az/el rotator is given the elevation too; an azimuth-only one just the heading. It is left where the satellite set.
- With one rotator set up, it is chosen for you.
- The Sky page shows where the rotator is pointed while it tracks, under the chart, beside the Doppler line.

## Good to know

- Set up your rotator under Station Configuration first. The app drives it (Hamlib rotctld, PstRotator, Yaesu GS-232, Green Heron).
- A pass that crosses your rotator's end stop is not flipped over the top yet: the rotator goes the long way round.

## Still true from 0.7.0

- Smoother live updates on the Sky and Map pages.
- Doppler tracking, and the Map tab.
- Needs a Ham2K Logger that speaks extension API 25 or later.

Feedback and corrections are welcome. Please reach out to KM4BE with suggestions!
