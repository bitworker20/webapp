# Runtime assets in `public/`

Everything under `public/` is served verbatim at the site root, and the Keplr
extension build stages the *same* files at its own root via CopyWebpackPlugin
(`POKER_ASSETS_DIR` in `keplr-wallet/apps/extension/webpack.config.js`). One
copy, two clients — the same arrangement as the shared sources in `src/poker`.

Keep `public/` free of documentation: it is published as-is.

## `gamecore.js` + `gamecore.wasm`

The transport-free BitPoker game core (mental-poker crypto, Texas Hold'em and
ZhaJinHua rules, wire codec, matchmaking derivation, dispute exports), built
with emscripten from this repo:

```sh
source /path/to/emsdk/emsdk_env.sh
bitpoker/wasm/build_and_test.sh
cp bitpoker/wasm/build-wasm/gamecore.{js,wasm} webapp/public/
```

Loaded at runtime as a classic script + wasm fetch — no bundler ever parses the
emscripten glue. `src/poker/worker.ts` pulls it in with
`importScripts("gamecore.js")` relative to the build root, which is why both
clients must stage it at the root rather than bundle it. Requires
`'wasm-unsafe-eval'` in the page's CSP (the extension manifests already carry
it; the web client sets it in its deploy config).

The embind API is documented in `bitpoker/wasm/README.md`.

## `cards/`

The 52 face SVGs and `card-back.png`, generated from this repo:

```sh
python3 tools/prepare_card_assets.py <raw-artwork-dir>
```

That script writes `bitpoker/assets/cards/` (used by the Qt and Android clients
through a qrc) and mirrors the result here. Do not edit these files — regenerate
instead, or the clients drift apart.

`src/poker/ui/cards.tsx` addresses them by plain URL (`cards/SPADE-1.svg`)
rather than importing them. That is deliberate: the file is compiled by webpack
for the extension and by Vite/Rollup for the web client, and a plain URL is the
only form both bundlers agree on (a template-literal `require` is a webpack
context module; `import.meta.glob` is Vite-only).

Faces and back share one geometry (a 238.111 x 332.599 box with rounded
transparent corners baked in), so a single CSS height drives both and neither
needs masking.

### Licence

The **face** artwork is *Vector Playing Cards 3.2*, Copyright 2011, 2020
Chris Aguilar <conjurenation@gmail.com>, licensed under
[LGPL-3.0](https://opensource.org/licenses/lgpl-3.0.html). Each SVG carries the
notice as a comment, and the attribution is rendered on the poker page — the
licence requires it to stay visible in the shipped app.

`card-back.png` is original artwork for this project.
