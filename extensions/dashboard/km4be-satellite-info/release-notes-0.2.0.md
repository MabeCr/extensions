# KM4BE Satellite Info 0.2.0

You can now tell AMSAT what you heard without leaving the app. Each pass has a new Report page.

## What is new

**Report to AMSAT.** Open a pass and choose the Report page.
- Pick the transponder, from AMSAT's own list for that satellite.
- Say what you heard: Heard, Telemetry only, or Not heard.
- Your callsign is filled in from the operation, and you can change it before sending. Your grid square is filled in from the one the pane is using, and is optional.
- A line shows exactly what will be sent. **Send to AMSAT** asks you to confirm before anything goes.
- AMSAT replies whether it took the report, and the pane says so, or says why not. After a report is sent, the status marks in the list refresh to include it.

## What is sent to AMSAT

Only when you confirm a report: the satellite and transponder, what you heard, the time (to the quarter hour, in UTC), your callsign, and your grid square if you left one in. Reports are public on AMSAT's status page. Nothing is sent otherwise: apart from reports you send, the extension only downloads.

## Still true from 0.1.1

- It does not tune or control a radio yet.
- Not every satellite on the list has public orbit data, so some are listed with frequencies but no passes.

Feedback and corrections are welcome. Please reach out to KM4BE with suggestions!
