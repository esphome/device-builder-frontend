import { describe, expect, it } from "vitest";

import type { LocalizeFunc } from "../../src/common/localize.js";
import { actionFieldLabel } from "../../src/util/action-field-label.js";

// Interpolating stub mirroring the en.json ``{name} action`` template,
// so the test pins the derived ``name`` the util feeds to localize.
const localize: LocalizeFunc = (key, values) =>
  key === "device.action_field_label" ? `${values?.name} action` : key;

describe("actionFieldLabel", () => {
  it("humanises common cover action fields", () => {
    expect(actionFieldLabel("open_action", localize)).toBe("Open action");
    expect(actionFieldLabel("close_action", localize)).toBe("Close action");
    expect(actionFieldLabel("stop_action", localize)).toBe("Stop action");
  });

  it("humanises multi-word and unknown *_action fields", () => {
    expect(actionFieldLabel("malfunction_action", localize)).toBe("Malfunction action");
    expect(actionFieldLabel("fan_mode_low_action", localize)).toBe("Fan mode low action");
  });

  it("routes the cosmetic suffix through the localize template", () => {
    // A French-shaped stub proves the word/order localizes (the stem,
    // an English schema id, stays as-is).
    const fr: LocalizeFunc = (key, values) =>
      key === "device.action_field_label" ? `action ${values?.name}` : key;
    expect(actionFieldLabel("open_action", fr)).toBe("action Open");
  });

  it("handles a key without the suffix", () => {
    expect(actionFieldLabel("sequence", localize)).toBe("Sequence action");
  });

  it("falls back without throwing on an empty field", () => {
    // Not reachable from the call sites (the parser only passes matched
    // `*_action` keys), but the util must not crash if reused.
    expect(actionFieldLabel("", localize)).toBe("Action action");
  });
});
