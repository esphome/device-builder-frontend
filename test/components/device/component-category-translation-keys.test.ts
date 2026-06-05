import { describe, expect, it } from "vitest";
import { ComponentCategory } from "../../../src/api/types/components.js";
import enMessages from "../../../src/translations/en.json";

// The sidebar filter resolves each category label via
// ``localize("device.component_category_<id>")`` and only falls back to the
// backend-supplied English name when the key is missing — which surfaces as a
// mixed-language category panel for any unkeyed category (device-builder#1210).
// Pin that every backend-emitted category, plus the synthetic ``all`` filter,
// carries a key so a newly added category can't silently regress to English.
describe("component category translation keys", () => {
  const device = (enMessages as { device: Record<string, string> }).device;

  it.each(Object.values(ComponentCategory))(
    "defines a label for the %s category",
    (category) => {
      const key = `component_category_${category}`;
      expect(device[key], `missing en.json key "device.${key}"`).toBeTruthy();
    }
  );

  it("defines a label for the synthetic 'all' filter", () => {
    expect(device.component_category_all).toBeTruthy();
  });
});
