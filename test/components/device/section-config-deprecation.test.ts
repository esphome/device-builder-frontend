/**
 * @vitest-environment happy-dom
 *
 * Pins that the host applies a deprecation notice's migration into the unsaved
 * draft: `applySectionValues` writes the nested `clk`, drops `clk_mode`
 * (`value: undefined` removes the key on serialization), and flushes one
 * `yaml-draft`.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";
import { applySectionValues } from "../../../src/components/device/device-section-config/draft-and-delete.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
function host(sectionKey: string, yaml: string, fromLine: number, values: object) {
  const c = new ESPHomeDeviceSectionConfig();
  const inner = c as any;
  inner.yaml = yaml;
  inner.sectionKey = sectionKey;
  inner.fromLine = fromLine;
  inner._config = { entries: [] };
  inner._presentComponents = new Set<string>();
  inner._values = values;
  const drafts: string[] = [];
  c.addEventListener("yaml-draft", (e) =>
    drafts.push((e as CustomEvent).detail.yaml as string)
  );
  return { c, inner, drafts };
}

describe("applySectionValues — ethernet clk_mode migration", () => {
  it("writes nested clk, removes clk_mode, dispatches one yaml-draft", () => {
    const yaml =
      "ethernet:\n" +
      "  type: LAN8720\n" +
      "  mdc_pin: GPIO23\n" +
      "  mdio_pin: GPIO18\n" +
      "  clk_mode: GPIO17_OUT\n" +
      "  phy_addr: 0\n";
    const { c, inner, drafts } = host("ethernet", yaml, 1, {
      type: "LAN8720",
      mdc_pin: "GPIO23",
      mdio_pin: "GPIO18",
      clk_mode: "GPIO17_OUT",
      phy_addr: 0,
    });
    applySectionValues(c, [
      { path: ["clk"], value: { pin: "GPIO17", mode: "CLK_OUT" } },
      { path: ["clk_mode"], value: undefined },
    ]);
    expect(inner._values.clk).toEqual({ pin: "GPIO17", mode: "CLK_OUT" });
    expect(inner._values.clk_mode).toBeUndefined();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toContain("clk:");
    expect(drafts[0]).toContain("pin: GPIO17");
    expect(drafts[0]).toContain("mode: CLK_OUT");
    expect(drafts[0]).not.toContain("clk_mode");
    // Untouched siblings survive the splice.
    expect(drafts[0]).toContain("mdc_pin: GPIO23");
    expect(drafts[0]).toContain("phy_addr: 0");
  });
});
