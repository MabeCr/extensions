# satellites.json

What we know of each satellite that the feeds do not say, or get wrong. Keys are the names in the Ham2K list (`polo.ham2k.com/data/satellites.json`). Every field is optional; see `CuratedInfo` in `../data.ts`.

| Field | Meaning |
|---|---|
| `norad` | The right NORAD number, where the list's is wrong. `null` where the list's is wrong and the right one is not known: no orbit is used rather than another satellite's. |
| `amsat` | Names AMSAT's status page knows it by, where not its own name. |
| `uplinks`, `downlinks` | Replace the list's frequencies for this satellite, where they are wrong. |
| `inversion` | How a linear transponder turns sidebands over: `inverting`, `non-inverting`, or a note where it differs by mode. |
| `ctcssHz` | The CTCSS access tone for an FM satellite. |
| `beaconMHz` | The beacon to find the satellite by. |
| `tips` | One short line (the Radio page shows it as it is). |
| `links` | `{ label, url }` pages to read more, shown by the Links button. |

## Where it came from

Looked up on 2026-10-07 from AMSAT's own pages, and nothing recorded that they did not say:

- [Live FM Satellites](https://www.amsat.org/live-fm-satellites/): access tones, SO-50's arming tone, IO-86's frequencies, notes, and the per-satellite links.
- [Live Linear Satellites](https://www.amsat.org/linear-satellite-frequency-summary/) (updated 2026-03-24): beacons, the per-satellite links, and whether each transponder is inverting (AO-7: Mode A non-inverting, Mode B inverting; AO-73, FO-29, JO-97, RS-44, TO-108 inverting; QO-100 non-inverting). The kind of transponder itself (`fm`, `linear`, `digital`) is the Ham2K list's own `modulation`, not recorded here.
- NORAD numbers for FO-29 (24278) and IO-117 (53109) from CelesTrak's own element sets, which name them (`JAS-2 (FO-29)`, `GREENCUBE (IO-117)`). IO-117 is 53106 in AMSAT's database, but 53106 at CelesTrak and SatNOGS is `MT-CUBE-2`, another payload from the same launch, so 53109 is used.
- AO-92 (`norad: null`): the list gives it 43017, which is AO-91's number, so it would have been drawn on AO-91's orbit. AMSAT's database has 43437, which CelesTrak names `SENTINEL-3B`. Neither CelesTrak nor SatNOGS has elements under 43137, the number I would expect, so none is set and AO-92 shows no passes.
- ARISS is the ISS (told to us by the extension's owner), hence `amsat: ["ISS"]`. SO-125 is HADES-ICM (likewise); AMSAT's status catalog has no entry for it.

Left out on purpose: anything that changes week to week (whether a transponder is on, a satellite's health), since it would be wrong by the time anyone read it. AMSAT's status page, which the Links button always offers, is the place for that.

Not covered: the digipeater, imaging and miscellaneous AMSAT lists; the Tevel satellites (`Tevel-N` and AMSAT's `TEVEL2-N` are different satellites, so there is no mapping, and neither CelesTrak nor SatNOGS has elements for the list's Tevel numbers); and the satellites that neither CelesTrak nor SatNOGS has orbit data for: BeliefSat-0, CAS-4A, CAS-4B, FO-99, LEDSAT, SO-121, SO-124, SO-125, XW-2A, XW-2B, XW-2C, EO-88, HO-119 and AO-92. They are listed, with their frequencies, but no passes can be worked out.
