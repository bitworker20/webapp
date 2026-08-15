// @bitpoker/poker-session — the headless session layer (relay transport,
// gamecore worker, hand state machine) — needs no configuration here: it is an
// npm workspace under packages/, so it resolves through node_modules like any
// other dependency. This client only renders it; nothing under src/
// reimplements a protocol.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // The key never leaves page memory, but a readable bundle is still the
    // only way a user (or we) can audit what the deployed page actually does.
    // See docs/webapp-threat-model.md — this build is testnet-only.
    sourcemap: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    // The poker specs came over from the extension's jest setup and use bare
    // describe/it/expect. Keeping globals on means those files stay identical
    // in both builds instead of forking over a test import.
    globals: true,
  },
});
