# KM4BE Satellite Info 0.5.0

Your radio can now follow the satellite.

## New

- **Doppler tracking.** A Track Doppler switch on a pass's Radio page keeps your logging radio on the satellite's downlink, retuning it every second as the shift changes. Before rise it waits on the frequency the satellite will first be heard on, and it stops on its own after the satellite sets.
- **Tune across a transponder and it follows you.** Turn the dial and the frequency you moved to at the satellite is kept, so the station you found stays put while the shift moves under it.
- **Uplink too.** Choose a second receiver under "Uplink on" (an IC-9700's Sub, or another radio) and your transmit frequency is corrected as well, through the transponder, inverting or not.
- **The Sky page says where the radio is** while tracking, so you can keep the chart in front.

## Good to know

- Installing this version asks to control your radio. It tunes only while Track Doppler is on, and never transmits.
- It sets the mode once when it starts: FM for an FM satellite, USB for a linear one. Split, satellite mode and tones stay with your radio's settings.

## Still true from 0.4.7

- Elevation and compass heading sit together in the sky chart's bottom left corner.
- AMSAT's status marks and reports use status.amsat.org.

Feedback and corrections are welcome. Please reach out to KM4BE with suggestions!
