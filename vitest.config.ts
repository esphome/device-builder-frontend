import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: false,
    silent: true,
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
});
