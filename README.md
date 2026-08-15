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
packages/poker-session/  @bitpoker/poker-session — the headless session layer
src/app.css              design tokens + the component classes the screens use
src/App.tsx              the shell: gate -> account -> nav + the live session
src/ui/                  the screens (play, wallet, activity, settings, onboarding)
src/poker/               the felt table, and the hook that owns the game session
src/wallet/              key custody: armor import, in-memory key, signing, txs
public/                  staged at build time from the package — nothing tracked
```

Four screens: **Play** (open games + create one), **Wallet** (balance, address,
transfer with a fee quoted by the chain), **Activity** (this account's
transactions, read from the node's tx index), **Settings** (endpoints the
deployment fixed, the key, diagnostics). A live session takes over the Play
screen; the wallet stays reachable mid-hand and the nav shows the table is
live.

`packages/poker-session/` holds everything that is *not* a matter of taste:
relay transport, the gamecore wasm worker, the hand state machine, bet bounds,
chain queries. The Keplr extension page runs the same code from a **vendored
copy** (`keplr-wallet/apps/extension/vendor/bitpoker-session/`, refreshed by
`tools/sync-poker-session.sh` and hash-checked in CI), so the protocol cannot
drift between the two clients while the two UIs stay free to look nothing
alike. Consequences worth knowing:

- **Those sources must stay bundler-agnostic.** They are compiled by webpack
  *and* by Vite/Rollup, so no `require()` context modules and no
  `import.meta.glob`. Card art is addressed by plain URL for this reason.
  Anything under `src/` here is Vite-only and may use whatever it likes.
- **TypeScript is pinned to ~5.6** (see the note in `tsconfig.json`): the
  extension is on 5.0, and 5.7's generic `Uint8Array` would fork the dialect.

The seam between the hosts is `packages/poker-session/src/wallet-bridge.ts`.
The extension passes a bridge that talks to its background service; this client
passes `BrowserKeyBridge`, which signs in the page.

## Where this directory lives

It is developed inside the BitPoker monorepo and **mirrored one-way** to
`github.com/bitworker20/webapp` (`make webapp-mirror` at the monorepo root) so
a deployment host can build the page from a small clone instead of the whole
repo and its six submodules. The mirror is a publishing target, not a fork:
never commit to it directly — changes there will be overwritten by the next
push.

Everything needed to build and serve the page is here, including the gamecore
artifacts in `packages/poker-session/assets/`, so `npm ci && npm run build`
works in a bare clone. (That is also why the session package lives *inside*
this directory rather than beside it at the monorepo root: the mirror is a
`git subtree push --prefix=webapp`, and a sibling directory would not travel
with it.) Two things do *not* work in a bare clone:

- **`npm run test:e2e`** borrows `puppeteer-core` from the keplr-wallet
  workspace (`../keplr-wallet/node_modules`), so it only runs from the
  monorepo. `npm test` runs anywhere.
- **`docs/webapp-threat-model.md`** and **`docs/webapp/deployment.md`**, linked
  from here, live in the monorepo.

`packages/poker-session/assets/gamecore.{js,wasm}` are checked-in build outputs
of the monorepo's `bitpoker/wasm` target — see that package's
[README](packages/poker-session/README.md) for how to refresh them. They can
only be regenerated there, so they go stale silently if someone changes the C++
gamecore without re-running that copy.

## Develop

```sh
source /path/to/emsdk/emsdk_env.sh   # node lives here on this machine
npm install
npm run dev
```

## Test

```sh
npm test          # unit: armor/key custody, tx encoding, bridge signing,
                  #       plus the session package's own specs
npm run build
npm run test:e2e  # browser: risk gate -> key import -> gamecore selfTest in the worker
npm run test:fee  # live chain: the fee this client pays is the one the node asks for
```

`npm test` includes two fixtures worth knowing about:

- **`src/wallet/armor.spec.ts`** pins the reader against a real
  `pokerchaind keys export` blob. If the SDK changes its KDF or cipher, this
  fails and players can no longer import keys.
- **`packages/poker-session/fixtures/chain-tx-vectors.json`** pins this
  client's pokerchain encoder against the extension's, which asserts the same
  fixture (through its vendored copy) in
  `keplr-wallet/apps/extension/src/poker-tx-vectors.spec.ts`, so the two cannot
  drift on a field number. (They cannot share the encoder file: the background
  package compiles with `rootDir: "src"`.)

`npm run test:fee` needs a running pokerchaind with a **non-zero**
`--minimum-gas-prices` and a funded key; see the header of
`tests/chain-fee.e2e.mjs`. It is the only test that proves the client's fee is
accepted rather than merely well-formed.

`npm run test:e2e` needs `google-chrome` on `PATH` (or `CHROME_PATH`) and
borrows `puppeteer-core` from the keplr-wallet workspace rather than adding a
dependency here.

## Play against a local chain

1. Run a node and a relay (see `docs/relay/deployment.md` and
   `pokerchain/readme.md`). The node's LCD must send CORS headers, because the
   page queries and broadcasts from the browser.
2. `npm run dev`, load the page, acknowledge the risk gate, and get an account
   in one of three ways:
   - **Create account** — generates a 24-word mnemonic in the page (cosmos
     path `m/44'/118'/0'/0/0`, so the same words work in every other client).
     Fund the address it shows: `pokerchaind tx bank send <funded> <address>`.
   - **Recover** — paste an existing mnemonic.
   - **Key file** — `pokerchaind keys export <name> > player.key`, then upload.
3. Create or join a game from the lobby.

`src/wallet/mnemonic.spec.ts` pins the derivation against the same golden
vector as `bitpoker/test/wallet/hd_wallet_test.cpp`, so an account made in the
browser is the account `pokerchaind keys add --recover` reproduces — not a
browser-only one.

## Configure a deployment

Build-time `VITE_*` variables (see `src/config.ts`): `VITE_CHAIN_ID`,
`VITE_BECH32_PREFIX`, `VITE_LCD_URL`, `VITE_RELAY_URL`. The endpoints are the
publisher's choice, not the player's — Settings shows them read-only, because
a node someone was talked into pasting can lie about balances, session state
and relay assignments.

Serve from a **dedicated origin** with a strict CSP that includes
`'wasm-unsafe-eval'`, over HTTPS (so relays must be `wss://`). The threat-model
doc explains why each of those is a requirement rather than a preference.

[`docs/webapp/deployment.md`](../docs/webapp/deployment.md) is the full recipe —
nginx with a working CSP, MIME and caching, what the node and relay have to
provide, and a verification checklist. Its config is tested rather than
described: extracted from the file and run against a real nginx and a real
Chrome.
