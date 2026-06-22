/**
 * @vitest-environment happy-dom
 *
 * Pins `device-section-config`'s caret-follow advanced reveal: when the
 * structured panel's `focusFieldPath` lands on a hidden advanced field, the
 * section reveals its advanced settings once (so the field renders and the
 * scroll-to-field can reach it) — honouring a later deliberate collapse.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import type { ConfigEntry } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";

const entry = (key: string, advanced: boolean): ConfigEntry =>
  ({ key, type: ConfigEntryType.STRING, label: key, advanced }) as ConfigEntry;

/** Bare instance with a config that has one plain and one advanced field. */
function makeHost(focusFieldPath: string[]) {
  const c = new ESPHomeDeviceSectionConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inner = c as any;
  inner.sectionKey = "text_sensor.version";
  inner._config = { entries: [entry("name", false), entry("hide_timestamp", true)] };
  inner.focusFieldPath = focusFieldPath;
  return inner;
}

// willUpdate passes the changed-property map; the reveal only runs when
// focusFieldPath or _config changed.
const focusChanged = () => new Map([["focusFieldPath", undefined]]);

describe("device-section-config — advanced reveal on caret-follow", () => {
  it("reveals advanced settings when the caret lands on a hidden advanced field", () => {
    const inner = makeHost(["hide_timestamp"]);
    expect(inner._showAdvanced).toBe(false);
    inner._revealAdvancedForFocus(focusChanged());
    expect(inner._showAdvanced).toBe(true);
  });

  it("does not reveal for a plain field", () => {
    const inner = makeHost(["name"]);
    inner._revealAdvancedForFocus(focusChanged());
    expect(inner._showAdvanced).toBe(false);
  });

  it("does not reopen after a deliberate collapse (revealed once)", () => {
    const inner = makeHost(["hide_timestamp"]);
    inner._revealAdvancedForFocus(focusChanged());
    expect(inner._showAdvanced).toBe(true);
    inner._setShowAdvanced(false); // user collapses
    inner._revealAdvancedForFocus(focusChanged());
    expect(inner._showAdvanced).toBe(false);
  });

  it("ignores updates where neither focusFieldPath nor _config changed", () => {
    const inner = makeHost(["hide_timestamp"]);
    inner._revealAdvancedForFocus(new Map()); // e.g. an unrelated re-render
    expect(inner._showAdvanced).toBe(false);
  });
});
