# Dashboard extensions

`ham2k-custom-text` provides the text panel. The SVG reference panels
live here rather than being bundled into HaLo:

- `ki2d-weather-panel`: forecast, hourly inspection and weather icons.
- `ki2d-solar-panel`: solar conditions, propagation, MUF and foF2 from the
  nearest ionosonde (KC2G), and history charts, each row and the theme chosen
  per placement.
- `ki2d-radio-panel`: a radio front panel, including Modern/LCD displays, radio
  selection, tuning, connection controls and received-signal metering.
  Its manifest declares `requiresRadioWrite`: the host refuses the radio
  calls to an extension that does not, and names the claim at install.
- `ki2d-rate-chart`: QSO rates over the trailing 10 and 60 minutes and the
  last 10 contacts, with peaks, lows, a rate goal, and a chart per operator
  for multi-operator stations.

The weather, solar and rate panels each offer a theme per placement —
Automatic, Light, Dark or Teal — from `packages/lib-panel-themes`.

All of them are published to the extension catalog at
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
`@ham2k/ext-ki2d-solar-panel`.

To see a panel while working on it, preview it in a browser:

```sh
node scripts/preview-panels.mjs extensions/dashboard/ki2d-solar-panel
```

It serves every panel the extension registers at http://localhost:4417/, at
several pane sizes in light and dark, and rebuilds and re-renders on each
change to the source. Hovering a chart inspects it, and buttons send their
events to the panel. A `preview.json` beside the manifest adds cases (an
operation, a QSO, a placement's settings, a locale); the script's header
describes its fields. Network responses are cached for 15 minutes, radio
panels see a demo radio, and the browser lays out the text, so check spacing
on a device before calling it final. A new release goes to the catalog with
`h2kext-publish`, under a new version: a version's bundle is frozen once the
catalog approves it.
