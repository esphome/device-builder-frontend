/**
 * Source-scan test for the shared ``renderAdvancedToggle`` helper —
 * the single home for the advanced-toggle-row markup and the
 * ``device.show_advanced`` label that four form hosts share.
 */
import { describe, expect, it } from "vitest";

async function readSource(): Promise<string> {
  // @ts-ignore — node-only module
  const fs = await import("node:fs");
  // @ts-ignore — node-only module
  const path = await import("node:path");
  // @ts-ignore — node-only module
  const url = await import("node:url");
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  return fs.readFileSync(
    path.resolve(here, "../../../src/components/device/advanced-toggle.ts"),
    "utf-8"
  );
}

describe("renderAdvancedToggle", () => {
  it("renders the advanced-toggle-row switch with the show_advanced label", async () => {
    const src = await readSource();
    expect(src).toContain('class="advanced-toggle-row"');
    expect(src).toContain("<wa-switch");
    expect(src).toContain('localize("device.show_advanced")');
  });

  it("reports the switch state back through the onChange callback", async () => {
    const src = await readSource();
    expect(src).toMatch(/onChange\(\s*\(e\.target as[^)]*\)\.checked\s*\)/);
  });
});
