# satellite.js, vendored

This is the plain JavaScript SGP4 half of [satellite.js](https://github.com/shashwatak/satellite-js) 7.1.0 (MIT, see `LICENSE.md`), copied from the package's `dist/`.

One change: `index.js` and `index.d.ts` lose their `export * from './wasm/index.js'` line, and the `wasm/` directory is not copied. The WebAssembly build loads Node modules and uses top-level await, which neither the Ham2K extension sandbox nor its build preset can take, and nothing here uses it.

To update, copy `dist/` from the new release the same way.
