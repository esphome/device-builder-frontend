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
