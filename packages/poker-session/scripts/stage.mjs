// Stages this package's runtime files into a host's web root.
//
// Three things have to sit at the site root rather than inside a bundle:
//
//   pokerWorker.bundle.js  worker-client.ts starts it with
//                          `new Worker("pokerWorker.bundle.js")` — a plain
//                          path, deliberately, so the same source works under
//                          webpack and under Rollup/Vite.
//   gamecore.js/.wasm      emscripten output, pulled in by the worker with
//                          importScripts(), which only a classic worker can do
//                          and which no bundler ever parses.
//   cards/                 addressed by plain URL from the host's card view.
//
// Usage: node scripts/stage.mjs <target-dir>
//
// The Keplr extension does not use this script: its webpack build compiles
// src/worker.ts as its own entry and copies assets/ with CopyWebpackPlugin.
// Both routes produce the same three things at the same root.
import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/stage.mjs <target-dir>");
  process.exit(1);
}
const out = resolve(process.cwd(), target);
await mkdir(out, { recursive: true });

await build({
  entryPoints: [resolve(root, "src/worker.ts")],
  outfile: resolve(out, "pokerWorker.bundle.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  sourcemap: true,
  logLevel: "info",
});

for (const asset of ["gamecore.js", "gamecore.wasm", "cards"]) {
  await cp(resolve(root, "assets", asset), resolve(out, asset), {
    recursive: true,
  });
}

console.log(`staged gamecore + cards into ${out}`);
