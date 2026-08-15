import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    // Bare describe/it/expect: these specs are also readable by the Keplr
    // extension's jest, and keeping globals on means the vendored copy stays
    // byte-identical instead of forking over a test import.
    globals: true,
  },
});
