# Runtime assets in `public/`

**Nothing in `public/` is tracked any more.** `npm run stage` (which `npm run
dev` and `npm run build` both run first) copies it in from the session package:

| Staged file | Source |
|---|---|
| `pokerWorker.bundle.js` | esbuilt from `packages/poker-session/src/worker.ts` |
| `gamecore.js`, `gamecore.wasm` | `packages/poker-session/assets/` |
| `cards/` | `packages/poker-session/assets/cards/` |

They have to sit at the site root rather than inside the bundle: the worker is
started by plain path, it pulls in the emscripten glue with `importScripts()`,
and the card faces are addressed by plain URL. The Keplr extension stages the
same three things at its own root from its vendored copy of the package.

For where those files come from, how to regenerate them, the CSP requirement
(`'wasm-unsafe-eval'`) and the LGPL attribution the card art carries, see
[`packages/poker-session/README.md`](packages/poker-session/README.md).

Keep `public/` free of documentation: it is published as-is.
