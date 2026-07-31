/**
 * @vitest-environment happy-dom
 *
 * Pins the host's `applySectionValues`: writes a nested replacement value,
 * drops a key via `value: undefined`, and flushes one `yaml-draft`.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";
import { applySectionValues } from "../../../src/components/device/device-section-config/draft-and-delete.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
function host(
  sectionKey: string,
  yaml: string,
  fromLine: number | undefined,
  values: object
) {
  const c = new ESPHomeDeviceSectionConfig();
  const inner = c as any;
  inner.yaml = yaml;
  inner.sectionKey = sectionKey;
  inner.fromLine = fromLine;
  inner.configuration = "dev.yaml";
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

describe("applySectionValues — package-provided section has no local block", () => {
  // api from a `packages:` include: no local `api:` key, so the splice can't
  // reach it. Enabling encryption must append a fresh block so it merges with
  // the package instead of silently dropping the write.
  const PACKAGE_YAML = "packages:\n  x: github://a/b\nwifi:\n  ssid: !secret s\n";

  it("appends a new top-level block with an unquoted !secret tag", () => {
    const { c, drafts } = host("api", PACKAGE_YAML, undefined, {});

    applySectionValues(c, [{ path: ["encryption", "key"], value: "!secret k" }]);

    expect(drafts).toHaveLength(1);
    // Prior content is preserved, and the block is appended (not spliced).
    expect(drafts[0]).toContain("packages:");
    expect(drafts[0]).toContain("api:");
    expect(drafts[0]).toContain("encryption:");
    // The secret round-trips as a real tag, not a quoted literal string.
    expect(drafts[0]).toContain("key: !secret k");
    expect(drafts[0]).not.toContain('"!secret k"');
  });

  it("splices into an existing local block (no new top-level key)", () => {
    const yaml = "api:\n  reboot_timeout: 0s\n";
    const { c, drafts } = host("api", yaml, 1, { reboot_timeout: "0s" });

    applySectionValues(c, [{ path: ["encryption", "key"], value: "!secret k" }]);

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toContain("key: !secret k");
    expect(drafts[0]).toContain("reboot_timeout: 0s");
    // Spliced into the one api block, not a second appended api:.
    expect(drafts[0].match(/^api:/gm) ?? []).toHaveLength(1);
  });

  it("leaves a dotted platform section (ota.esphome) to the flush (no block appended)", () => {
    const { c, drafts } = host("ota.esphome", PACKAGE_YAML, undefined, {});

    applySectionValues(c, [{ path: ["password"], value: "!secret p" }]);
    // No local ota block to splice and no map-singleton append path → dropped.
    expect(drafts).toHaveLength(0);
  });

  it("leaves a list-bodied section (globals) to the flush (wrong shape to append)", () => {
    const { c, drafts } = host("globals", PACKAGE_YAML, undefined, {});

    applySectionValues(c, [{ path: ["id"], value: "x" }]);
    // globals is a YAML list, not a map singleton — appending a map block would
    // be malformed, so it is not created here.
    expect(drafts).toHaveLength(0);
  });
});
