# BitPoker web client

Plays heads-up Texas Hold'em and ZhaJinHua against a peer over a BitPoker
relay, with on-chain matchmaking, escrowed settlement and dispute submission —
from an ordinary web page, with no extension installed.

**Testnet and small stakes only.** This client decrypts the account key in the
page and holds it in tab memory. Read
[`docs/webapp-threat-model.md`](../docs/webapp-threat-model.md) before
deploying it anywhere, and point players with real balances at the desktop or
mobile client.

## Layout

```
src/poker/     the game client — SHARED VERBATIM with the Keplr extension
src/wallet/    key custody: armor import, in-memory key, signing, transactions
src/ui/        the screens that exist only because the key is in the page
public/        runtime assets, also staged by the extension build (see ASSETS.md)
```

`src/poker/` is the single copy of the poker page, its session controller,
relay client and gamecore worker. The Keplr extension compiles the same files
through a `@bitpoker/poker-core` alias
(`keplr-wallet/apps/extension/webpack.config.js`), so a fix lands in both
clients at once. Two consequences:

- **The keplr-wallet submodule no longer builds standalone** — it needs this
  repo checked out around it.
- **These sources must stay bundler-agnostic.** They are compiled by webpack
  *and* by Vite/Rollup, so no `require()` context modules and no
  `import.meta.glob`. Card art is addressed by plain URL for this reason.
- **TypeScript is pinned to ~5.6** (see the note in `tsconfig.json`): the
  extension is on 5.0, and 5.7's generic `Uint8Array` would fork the dialect.

The seam between the two is `src/poker/wallet-bridge.ts`. The extension passes
a bridge that talks to its background service; this client passes
`BrowserKeyBridge`, which signs in the page.

## Where this directory lives

It is developed inside the BitPoker monorepo and **mirrored one-way** to
`github.com/bitworker20/webapp` (`make webapp-mirror` at the monorepo root) so
a deployment host can build the page from a small clone instead of the whole
repo and its six submodules. The mirror is a publishing target, not a fork:
never commit to it directly — changes there will be overwritten by the next
push.

Everything needed to build and serve the page is here, including the
`public/gamecore.{js,wasm}` artifacts, so `npm ci && npm run build` works in a
bare clone. Two things do *not*:

- **`npm run test:e2e`** borrows `puppeteer-core` from the keplr-wallet
  workspace (`../keplr-wallet/node_modules`), so it only runs from the
  monorepo. `npm test` runs anywhere.
- **`docs/webapp-threat-model.md`** and **`docs/webapp/deployment.md`**, linked
  from here, live in the monorepo.

`public/gamecore.{js,wasm}` are checked-in build outputs of the monorepo's
`bitpoker/wasm` target — see [`ASSETS.md`](ASSETS.md) for how to refresh them.
They can only be regenerated there, so they go stale silently if someone
changes the C++ gamecore without re-running that copy.

## Develop

```sh
source /path/to/emsdk/emsdk_env.sh   # node lives here on this machine
npm install
npm run dev
```

## Test

```sh
npm test          # unit: armor/key custody, tx encoding, bridge signing
npm run build
npm run test:e2e  # browser: risk gate -> key import -> gamecore selfTest in the worker
```

`npm test` includes two fixtures worth knowing about:

- **`src/wallet/armor.spec.ts`** pins the reader against a real
  `pokerchaind keys export` blob. If the SDK changes its KDF or cipher, this
  fails and players can no longer import keys.
- **`src/poker/chain-tx-vectors.json`** pins this client's pokerchain encoder
  against the extension's. The extension asserts the same fixture in
  `keplr-wallet/apps/extension/src/poker-tx-vectors.spec.ts`, so the two cannot
  drift on a field number. (They cannot share the encoder file: the background
  package compiles with `rootDir: "src"`.)

`npm run test:e2e` needs `google-chrome` on `PATH` (or `CHROME_PATH`) and
borrows `puppeteer-core` from the keplr-wallet workspace rather than adding a
dependency here.

## Play against a local chain

1. Run a node and a relay (see `docs/relay/deployment.md` and
   `pokerchain/readme.md`). The node's LCD must send CORS headers, because the
   page queries and broadcasts from the browser.
2. Export a funded testnet key:
   `pokerchaind keys export <name> > player.key`
3. `npm run dev`, load the page, acknowledge the risk gate, import
   `player.key`, then create or join a game from the lobby.

## Configure a deployment

Build-time `VITE_*` variables (see `src/config.ts`): `VITE_CHAIN_ID`,
`VITE_BECH32_PREFIX`, `VITE_LCD_URL`, `VITE_RELAY_URL`. Endpoints are defaults
the player can still override in the page.

Serve from a **dedicated origin** with a strict CSP that includes
`'wasm-unsafe-eval'`, over HTTPS (so relays must be `wss://`). The threat-model
doc explains why each of those is a requirement rather than a preference.

[`docs/webapp/deployment.md`](../docs/webapp/deployment.md) is the full recipe —
nginx with a working CSP, MIME and caching, what the node and relay have to
provide, and a verification checklist. Its config is tested rather than
described: extracted from the file and run against a real nginx and a real
Chrome.
