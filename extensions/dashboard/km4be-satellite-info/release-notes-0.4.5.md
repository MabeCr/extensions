# KM4BE Satellite Info 0.4.5

AMSAT moved its status service, and this release follows it.

## Fixed

- **AMSAT's status marks and reports work again.** The status service now lives at status.amsat.org, and the old amsat.org address only redirects there, which this extension could not follow. The marks in the pass list, the AMSAT lines on a pass's page, the satellite list on the Report page and sending a report all use the new address.
- **Report times match AMSAT's new periods.** A report is kept by the quarter hour, and AMSAT now counts them as :00–:14, :15–:29, :30–:44 and :45–:59. The time shown when you confirm a report says so.
- **A corrected report says so.** If AMSAT already had a report from you for that satellite and quarter hour, the message after sending says the new one corrects it.

## Still true from 0.4.4

- The satellite list and the orbits are the app's offline data, and orbits come through Ham2K's caching proxy.
- It does not tune or control a radio yet.
- Reports you send go to AMSAT's public status page, only when you confirm them.

Feedback and corrections are welcome. Please reach out to KM4BE with suggestions!
