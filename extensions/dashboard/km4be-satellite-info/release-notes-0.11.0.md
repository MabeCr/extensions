# KM4BE Satellite Info 0.11.0

Satellites on the Band Scope.

## New

- **Band scope labels.** Turn on "Label satellites on the band scope" in the panel's settings. Each satellite that is up, or about to rise, is marked on the Band Scope where you will hear it: "AO-7 ↓" over a linear transponder's passband, or at an FM satellite's frequency, corrected for Doppler and moving with the shift as the pass goes. Its uplink is marked "AO-7 ↑", a step less prominent. The marks come off when the satellite sets.
- **One favorites switch for both.** "Alerts and labels for favorites only" limits the alerts and the labels to the satellites you have starred. The lead time before rise applies to both too.

## Good to know

- Labels work with the panel closed, like the alerts.
- At most six satellites are labeled at once, soonest first.
- A label moves when the shift has changed by half a kilohertz, so the scope is not redrawn for a change you could not see.

## Still true from 0.10.0

- Pass alerts, logging contacts via the satellite, rotator tracking, Doppler tracking, the Map tab and smoother live updates.
- Needs a Ham2K Logger that speaks extension API 25 or later.

Feedback and corrections are welcome. Please reach out to KM4BE with suggestions!
