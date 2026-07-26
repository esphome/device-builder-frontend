/**
 * @vitest-environment happy-dom
 *
 * Pins that the component editor's dirty-change names its emitter,
 * the field the page's identity guard keys on (#1486).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import "../../_mock-webawesome.js";

import { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";
import type { SectionDirtyChangeDetail } from "../../../src/components/device/section-editor.js";

describe("dirty-change payload", () => {
  it("names the emitting element", () => {
    const c = new ESPHomeDeviceSectionConfig();
    const flips: SectionDirtyChangeDetail[] = [];
    c.addEventListener("dirty-change", (e) =>
      flips.push((e as CustomEvent<SectionDirtyChangeDetail>).detail)
    );

    c._setDirty(true);

    expect(flips).toEqual([{ dirty: true, node: c }]);
  });
});
