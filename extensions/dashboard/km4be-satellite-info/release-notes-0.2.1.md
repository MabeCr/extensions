# KM4BE Satellite Info 0.2.1

A round of improvements to the pass list and a pass's page, and a fix to reports to AMSAT.

## What is new

- **Run a finger along the pass.** On the Sky page, drag left to right over the plot (or move the mouse over it on a desktop) to step through the pass from rise to set. A marker follows the satellite's path, and the corners of the plot show the downlink and uplink frequencies with their Doppler shift at that moment, along with the time and elevation. It works for passes that have not started yet, so you can see the Doppler curve ahead of time. A Reset button appears over the corner of the plot while you are scrubbing, and puts the plot back to showing the live readout.
- **A list that lines up.** The columns in the pass list now line up under their titles. The list is set in a monospaced face at the largest size that fits your pane and your phone's text size, so every column is there. Tapping anywhere on a row still opens the pass. Where even a smaller size will not fit a line, the length goes first, and then the transponder's kind.
- **All comes first.** The list opens on All, which is now on the left of the switch, so starring one satellite no longer hides the rest. The view you pick is remembered the next time you open the app. Favorites with nothing followed says to tap a star on All.
- **Choose the sky chart's size.** A new setting, Sky chart size, takes 40 to 100 percent of the room the pane allows. Make it smaller to see the times and the lines under the chart without the chart filling the pane.
- **Smaller pass page controls.** The back button and the Sky, Radio and Report tabs are lower, which leaves more room for the chart.

## Changed

- **The sky plot keeps its size** in a short pane. The lines under it are cut off first, and the new setting is how to give them room.
- **Reports to AMSAT** are now sent through AMSAT's status API, which says whether it recorded the report. The pane shows AMSAT's answer, or the reason it refused. Before, a report could look as if it was sent when AMSAT never received it.

## Still true from 0.1.1

- It does not tune or control a radio yet.
- Not every satellite on the list has public orbit data, so some are listed with frequencies but no passes.

Feedback and corrections are welcome. Please reach out to KM4BE with suggestions!
