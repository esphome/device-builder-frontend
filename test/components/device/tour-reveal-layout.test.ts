import { describe, expect, it } from "vitest";
import { layoutRevealingAnchor } from "../../../src/components/device/tour-reveal-layout.js";

describe("layoutRevealingAnchor", () => {
  it("mobile: reveals the hidden visual pane with the left-only layout", () => {
    // "both" collapses to the YAML pane on mobile, hiding "central".
    expect(layoutRevealingAnchor("central", "both", true)).toBe("left");
    expect(layoutRevealingAnchor("central", "right", true)).toBe("left");
  });

  it("mobile: reveals the hidden YAML pane with the right-only layout", () => {
    expect(layoutRevealingAnchor("yaml", "left", true)).toBe("right");
  });

  it("desktop: reveals a hidden pane by returning to the split view", () => {
    expect(layoutRevealingAnchor("central", "right", false)).toBe("both");
    expect(layoutRevealingAnchor("yaml", "left", false)).toBe("both");
  });

  it("returns null when the anchor is already visible", () => {
    expect(layoutRevealingAnchor("central", "both", false)).toBeNull();
    expect(layoutRevealingAnchor("central", "left", true)).toBeNull();
    expect(layoutRevealingAnchor("yaml", "both", false)).toBeNull();
    expect(layoutRevealingAnchor("yaml", "right", true)).toBeNull();
  });

  it("ignores anchors that aren't layout-dependent panes", () => {
    expect(layoutRevealingAnchor("install", "right", true)).toBeNull();
    expect(layoutRevealingAnchor("nav", "left", false)).toBeNull();
  });
});
