import { describe, expect, it } from "vitest";

import { deriveNavigatorBuckets } from "../../../src/components/device/navigator-buckets.js";

describe("package section in device navigator", () => {
  it("keeps packages out of core sections while retaining other sections", () => {
    const buckets = deriveNavigatorBuckets(
      [
        "esphome:",
        "  name: lamp",
        "packages:",
        "  base: !include packages/base.yaml",
        "wifi:",
        "sensor:",
        "  - platform: uptime",
        "",
      ].join("\n")
    );

    expect(buckets.core.map((section) => section.key)).not.toContain("packages");
    expect(buckets.core.map((section) => section.key)).toContain("wifi");
    expect(buckets.components.map((section) => section.key)).toContain("sensor");
  });
});
