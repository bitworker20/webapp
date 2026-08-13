// Builds the gamecore Web Worker as a single self-contained classic script.
//
// It cannot ride along in the Vite bundle: src/poker/worker-client.ts starts it
// with `new Worker("pokerWorker.bundle.js")` — a plain path, deliberately, so
// the same source works under webpack (extension) and Rollup (this client).
// The worker also uses importScripts("gamecore.js") to pull in the emscripten
// glue, which only a classic worker can do. So it gets its own esbuild pass
// with a fixed, unhashed name.
//
// Output goes to public/ rather than dist/ so `vite dev` serves it at the root
// too; it is generated, and .gitignore excludes it.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

await build({
  entryPoints: [resolve(root, "src/poker/worker.ts")],
  outfile: resolve(root, "public/pokerWorker.bundle.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  sourcemap: true,
  logLevel: "info",
});
