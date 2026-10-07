# Dashboard extensions

`ham2k-custom-text` provides the text panel. The three SVG reference panels
live here rather than being bundled into HaLo:

- `ki2d-weather-panel`: forecast, hourly inspection and weather icons.
- `ki2d-solar-panel`: solar conditions, propagation and history charts.
- `ki2d-radio-panel`: a radio front panel, including Modern/LCD displays, radio
  selection, tuning, connection controls and received-signal metering.
  Its manifest declares `requiresRadioWrite`: the host refuses the radio
  calls to an extension that does not, and names the claim at install.

`km4be-fuzzy-search` is a markdown panel: type part of a callsign and it lists
the stations in the current operation's log that contain it, as a table with one row each, with
the matching letters in bold. It is view only,
since a panel cannot write to the call field, and it searches one operation,
since the SDK reads the log per operation. Its keys follow the same
`<callsign>-<name>` convention, so it needs no `--force-name` and can be
side-loaded for testing.

All three SVG panels are published to the extension catalog at
[catalog.ham2k.net](https://catalog.ham2k.net). Their keys follow the
`<callsign>-<name>` convention, so a packed `.h2kext` also installs from a file
like any other extension; manage them under Features & Extensions. They need
Ham2K Logger 26.9.0 (170) or later; on older hosts the panels show an
unavailable message. The prototype's placements do not carry over, since a
placement is keyed by extension.

## Development

The three SVG panels need `@ham2k/extension-sdk` 0.5.0 or later, the first
release with `svgScene`, the render environment and the radio host APIs. It
installs from npm like any other dependency:

```sh
npm install
npm run typecheck --workspace @ham2k/ext-ki2d-radio-panel
npm run test --workspace @ham2k/ext-ki2d-radio-panel
npm run pack --workspace @ham2k/ext-ki2d-radio-panel
```

The same three scripts exist for `@ham2k/ext-ki2d-weather-panel` and
`@ham2k/ext-ki2d-solar-panel`. A new release goes to the catalog with
`h2kext-publish`, under a new version: a version's bundle is frozen once the
catalog approves it.
