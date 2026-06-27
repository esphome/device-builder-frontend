import { describe, expect, it } from "vitest";

import type { LocalizeFunc } from "../../src/common/localize.js";
import { updateButtonTitle } from "../../src/util/update-tooltip.js";

// Interpolating stub mirroring the en.json template, so the test pins the
// installed -> target ordering (the field-swap is the easy mistake) and the
// fallback path.
const localize: LocalizeFunc = (key, values) =>
  key === "dashboard.update_available_version"
    ? `Update available: ${values?.installed} → ${values?.target}`
    : key;

describe("updateButtonTitle", () => {
  it("shows installed -> target when both versions are known", () => {
    expect(updateButtonTitle(localize, "2024.6.0", "2024.12.0", "dashboard.update")).toBe(
      "Update available: 2024.6.0 → 2024.12.0"
    );
  });

  it("falls back to the button label when the installed version is unknown", () => {
    expect(updateButtonTitle(localize, "", "2024.12.0", "dashboard.update")).toBe(
      "dashboard.update"
    );
  });

  it("falls back to the button label when the target version is unknown", () => {
    expect(
      updateButtonTitle(localize, "2024.6.0", "", "dashboard.table_action_update")
    ).toBe("dashboard.table_action_update");
  });
});
