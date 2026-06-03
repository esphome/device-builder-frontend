import { describe, expect, it } from "vitest";

import { actionFieldLabel } from "../../src/util/action-field-label.js";

describe("actionFieldLabel", () => {
  it("humanises common cover action fields", () => {
    expect(actionFieldLabel("open_action")).toBe("Open action");
    expect(actionFieldLabel("close_action")).toBe("Close action");
    expect(actionFieldLabel("stop_action")).toBe("Stop action");
  });

  it("humanises multi-word and unknown *_action fields", () => {
    expect(actionFieldLabel("malfunction_action")).toBe("Malfunction action");
    expect(actionFieldLabel("fan_mode_low_action")).toBe("Fan mode low action");
  });

  it("falls back gracefully for keys without the suffix", () => {
    expect(actionFieldLabel("sequence")).toBe("Sequence action");
    expect(actionFieldLabel("")).toBe("Action");
  });
});
