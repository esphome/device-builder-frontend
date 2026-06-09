/**
 * Pins the core-row " Component" suffix trim in resolveNavItemLabels.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/util/component-name-cache.js", () => ({
  getCachedComponent: vi.fn(),
}));

import {
  type LabelContext,
  resolveNavItemLabels,
} from "../../../src/components/device/navigator-labels.js";
import { getCachedComponent } from "../../../src/util/component-name-cache.js";
import type { YamlSection } from "../../../src/util/yaml-sections.js";

const mockGetCached = vi.mocked(getCachedComponent);
const named = (name: string) =>
  ({ name }) as unknown as ReturnType<typeof getCachedComponent>;

const ctx: LabelContext = {
  triggerCatalog: {
    resolveName: () => "",
  } as unknown as LabelContext["triggerCatalog"],
  platform: "",
  deviceName: "",
  localize: (key) => key,
};

const item = (key: string): YamlSection => ({ key }) as unknown as YamlSection;

describe("resolveNavItemLabels core suffix", () => {
  it("strips a redundant ' Component' suffix on core rows", () => {
    mockGetCached.mockReturnValue(named("Native API Component"));
    expect(resolveNavItemLabels(item("api"), "core", ctx).primary).toBe("Native API");
  });

  it("keeps the full name on component rows", () => {
    mockGetCached.mockReturnValue(named("Custom Component"));
    expect(resolveNavItemLabels(item("custom"), "component", ctx).primary).toBe(
      "Custom Component"
    );
  });

  it("leaves a bare 'Component' name intact", () => {
    mockGetCached.mockReturnValue(named("Component"));
    expect(resolveNavItemLabels(item("x"), "core", ctx).primary).toBe("Component");
  });
});

describe("resolveNavItemLabels substitution resolution", () => {
  const subs = new Map([["upper_devicename", "Driveway Gate"]]);
  const row = (name: string): YamlSection =>
    ({ key: "binary_sensor", platform: "gpio", name }) as unknown as YamlSection;

  it("expands ${var} in the secondary label", () => {
    mockGetCached.mockReturnValue(undefined);
    const labels = resolveNavItemLabels(row("${upper_devicename} Moving"), "component", {
      ...ctx,
      substitutions: subs,
    });
    expect(labels.secondary).toBe("Driveway Gate Moving");
  });

  it("leaves an unknown ${var} literal", () => {
    mockGetCached.mockReturnValue(undefined);
    const labels = resolveNavItemLabels(row("${nope} Moving"), "component", {
      ...ctx,
      substitutions: subs,
    });
    expect(labels.secondary).toBe("${nope} Moving");
  });

  it("does not re-resolve the backend-resolved esphome device name", () => {
    mockGetCached.mockReturnValue(undefined);
    // A device name that happens to contain a substitution-key-shaped
    // substring must pass through untouched — it's already backend-expanded.
    const labels = resolveNavItemLabels(
      { key: "esphome" } as unknown as YamlSection,
      "core",
      { ...ctx, deviceName: "gate_$upper_devicename", substitutions: subs }
    );
    expect(labels.secondary).toBe("gate_$upper_devicename");
  });
});
