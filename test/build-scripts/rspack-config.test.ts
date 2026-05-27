import { describe, expect, it } from "vitest";

interface CopyPattern {
  from: string;
  to: string;
}

const loadPatterns = async (): Promise<CopyPattern[]> => {
  const mod = (await import("../../build-scripts/rspack.cjs")) as {
    createRspackConfig: () => {
      plugins: Array<{ constructor?: { name?: string }; _args?: unknown[] }>;
    };
  };
  const cfg = mod.createRspackConfig();
  const copyPlugin = cfg.plugins.find((p) => p?.constructor?.name === "CopyRspackPlugin");
  if (!copyPlugin) {
    throw new Error("CopyRspackPlugin not found in rspack plugins");
  }
  // CopyRspackPlugin stores its constructor args at `_args`.
  const firstArg = (copyPlugin._args ?? [])[0] as { patterns: CopyPattern[] };
  return firstArg.patterns;
};

describe("rspack config", () => {
  it("copies public/assets/ into the wheel output dir", async () => {
    // Regression: without this pattern, the published wheel ships
    // index.html and the JS bundles but no logos/board images, so
    // the running dashboard 404s every static asset request.
    const patterns = await loadPatterns();
    const assetsPattern = patterns.find((p) => p.from.endsWith("/public/assets"));
    expect(assetsPattern, "expected a copy pattern for public/assets").toBeDefined();
    expect(assetsPattern!.to).toMatch(/\/esphome_device_builder_frontend\/assets$/);
  });

  it("copies the package __init__.py so pip install ships where()", async () => {
    const patterns = await loadPatterns();
    const initPattern = patterns.find((p) => p.from.endsWith("/public/__init__.py"));
    expect(initPattern, "expected a copy pattern for __init__.py").toBeDefined();
    expect(initPattern!.to).toMatch(/\/esphome_device_builder_frontend\/__init__\.py$/);
  });
});
