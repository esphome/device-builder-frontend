import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Generate the language manifest before any test runs — src/common/
    // localize.ts statically imports it (see gen-language-manifest.cjs).
    globalSetup: ["./test/global-setup.mjs"],
    environment: "node",
    globals: false,
    silent: true,
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
});
