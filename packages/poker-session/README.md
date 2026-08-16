# `@bitpoker/poker-session`

The headless half of a BitPoker client: relay transport, the gamecore wasm
worker, and the state machine that drives one hand between them. **No UI.**

Two clients consume it, and they look nothing alike on purpose:

| Client | Where it lives | How it gets this package |
|---|---|---|
| Web client | `webapp/` | Vite alias → `src/` (same checkout) |
| Keplr extension page | `keplr-wallet/apps/extension/` | vendored copy under `apps/extension/vendor/bitpoker-session/`, refreshed by `tools/sync-poker-session.sh` |

The vendored copy is what lets the `keplr-wallet` submodule build on its own
again; CI re-runs the sync and fails on a diff, so the two copies cannot drift.

## What is in here

```
src/
  controller.ts     one hand end to end: matchmaking → shuffle → betting →
                    showdown → signed settlement → next hand
  relay-client.ts   poker-relayd websocket, ClientHello auth, framing
  endpoint-blob.ts  ADR-007 encrypted endpoint blob + transport keypair
  worker-client.ts  promise API over the gamecore worker
  worker.ts         the worker itself (importScripts("gamecore.js"))
  wallet-bridge.ts  PokerWalletBridge — the seam every host implements
  lobby.ts          chain queries: open intents, balances, block height
  recovery.ts       what can still be done about a session that stopped
                    moving: refund it, escalate it, reveal a secret, ask for
                    a verdict
  session-vault.ts  the per-hand session identity, kept in localStorage so a
                    reload can still reveal it (see below)
  fees.ts           the node's gas price + simulate, so no client hard-codes
                    a fee
  bet-bounds.ts     legal bet/raise range for TH and ZJH
  chip.ts types.ts  uchip↔CHIP formatting, snapshot types
fixtures/
  chain-tx-vectors.json   golden pokerchain tx encodings, shared by the web
                          client's encoder specs and the extension's
assets/
  gamecore.js/.wasm, cards/   staged at the site root, never bundled
```

`wallet-bridge.ts` is the whole host seam: the extension implements it against
its background service (key in a separate realm), the web client against a key
in page memory (testnet only — `docs/webapp-threat-model.md`).

### The one thing this package writes to disk

`session-vault.ts` stores the **per-hand session identity** (a FiatShamir
scalar, not the account key) in `localStorage` when an intent is opened, and
deletes it once it is spent. It exists because adjudication decrypts each
seat's cards from the secret that seat disclosed on chain and scores a seat
that disclosed none as forfeiting the whole escrow — and the hands that end up
disputed are exactly the ones where the tab, and the gamecore heap holding
that secret, are gone. Both hosts inherit this: the extension page has its own
`localStorage`, and the hand secret was already page-side there (the gamecore
runs in the page), so it adds no exposure the game did not already have.

## Two rules that must not be broken

Everything here is compiled by **both** webpack (extension) and Rollup/Vite
(web client), so it has to stay bundler-agnostic:

1. **No bundler-specific module syntax.** No webpack `require()` context
   modules, no Vite `import.meta.glob`. Card faces are therefore addressed by
   plain URL, not imported.
2. **The worker starts from a plain path**: `new Worker("pokerWorker.bundle.js")`,
   and pulls in the emscripten glue with `importScripts("gamecore.js")` — which
   only a classic worker can do. Both files must sit at the host's site root.

Rule 2 is what `scripts/stage.mjs` is for:

```sh
node scripts/stage.mjs ../../public   # what webapp's `npm run stage` does
```

It esbuilds `src/worker.ts` into `pokerWorker.bundle.js` and copies
`assets/` alongside it. The extension takes the other route to the same place:
webpack compiles `src/worker.ts` as its own entry and stages `assets/` with
CopyWebpackPlugin.

## Runtime assets

### `gamecore.js` + `gamecore.wasm`

The transport-free BitPoker game core (mental-poker crypto, Texas Hold'em and
ZhaJinHua rules, wire codec, matchmaking derivation, dispute exports), built
with emscripten from this repo:

```sh
source /path/to/emsdk/emsdk_env.sh
bitpoker/wasm/build_and_test.sh
cp bitpoker/wasm/build-wasm/gamecore.{js,wasm} webapp/packages/poker-session/assets/
```

Loaded as a classic script + wasm fetch — no bundler ever parses the emscripten
glue. Requires `'wasm-unsafe-eval'` in the host page's CSP (the extension
manifests already carry it; the web client sets it in its deploy config). The
embind API is documented in `bitpoker/wasm/README.md`.

### `cards/`

The 52 face SVGs and `card-back.png`, generated from this repo:

```sh
python3 tools/prepare_card_assets.py <raw-artwork-dir>
```

That script writes `bitpoker/assets/cards/` (used by the Qt and Android clients
through a qrc) and mirrors the result here. Do not edit these files —
regenerate instead, or the clients drift apart.

Faces and back share one geometry (a 238.111 x 332.599 box with rounded
transparent corners baked in), so a single CSS height drives both and neither
needs masking.

#### Licence

The **face** artwork is *Vector Playing Cards 3.2*, Copyright 2011, 2020
Chris Aguilar <conjurenation@gmail.com>, licensed under
[LGPL-3.0](https://opensource.org/licenses/lgpl-3.0.html). Each SVG carries the
notice as a comment, and the attribution must stay rendered in the shipped app
— the licence requires it to be visible.

`card-back.png` is original artwork for this project.

## Tests

```sh
npm install && npm test        # vitest: bet bounds, chip math, endpoint blob,
                               # lobby, fees, recovery, session vault
npm run typecheck
```
