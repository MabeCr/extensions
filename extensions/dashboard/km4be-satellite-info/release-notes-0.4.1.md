# KM4BE Satellite Info 0.4.1

A fix to the Report page.

## Fixed

- **The Report page could fail with an error** (`Invalid scene control: variant`) for a satellite that AMSAT has no status page for. AMSAT takes reports for only some of the satellites in the list, such as AO-7, AO-73, AO-91, AO-123, SO-50 and the ISS, and not for others. For those, the Transponder choice had nothing in it, which the app refuses. Now it says "No transponder to report on", the line under it says AMSAT has no entry for the satellite, and nothing can be sent.

## Still true from 0.4.0

- It does not tune or control a radio yet.
- Not every satellite on the list has public orbit data, so some are listed with frequencies but no passes.
- Reports you send go to AMSAT's public status page, only when you confirm them.

Feedback and corrections are welcome. Please reach out to KM4BE with suggestions!
