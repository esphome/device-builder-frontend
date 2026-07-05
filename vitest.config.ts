import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Generate the language manifest before any test runs — src/common/
    // localize.ts statically imports it (see gen-language-manifest.cjs).
    globalSetup: ["./test/global-setup.mjs"],
    // Per-file setup: registers the one global afterEach that clears
    // document.body between tests (see test/_setup-dom.ts).
    setupFiles: ["./test/_setup-dom.ts"],
    environment: "node",
    globals: false,
    silent: true,
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
});
