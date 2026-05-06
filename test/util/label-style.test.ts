import { describe, expect, it } from "vitest";
import {
  LABEL_COLOR_SWATCHES,
  labelChipStyle,
  labelChipStyleString,
} from "../../src/util/label-style.js";

const NEUTRAL_BG = "var(--wa-color-surface-lowered)";
const NEUTRAL_FG = "var(--wa-color-text-quiet)";
const NEUTRAL_BORDER = "var(--wa-color-surface-border)";

describe("labelChipStyle", () => {
  it("returns the neutral palette for null / undefined / empty input", () => {
    for (const value of [null, undefined, ""]) {
      const style = labelChipStyle(value);
      expect(style.background).toBe(NEUTRAL_BG);
      expect(style.color).toBe(NEUTRAL_FG);
      expect(style.borderColor).toBe(NEUTRAL_BORDER);
    }
  });

  it("falls back to neutral on malformed hex", () => {
    // Missing leading #, 3-char shorthand, non-hex chars, trailing
    // junk — the catalog stores ``#rrggbb`` lowercase but a hand-
    // edited sidecar could surface anything.
    for (const malformed of ["red", "#fff", "#abcz12", "#ffffff!", "#"]) {
      expect(labelChipStyle(malformed).background).toBe(NEUTRAL_BG);
    }
  });

  it("accepts uppercase hex (catalog lowercases on save, but defensive)", () => {
    const style = labelChipStyle("#FF0000");
    expect(style.background).toBe("#FF0000");
  });

  it("renders the supplied hex as the chip background", () => {
    const style = labelChipStyle("#22c55e");
    expect(style.background).toBe("#22c55e");
    expect(style.borderColor).toContain("color-mix");
    expect(style.borderColor).toContain("#22c55e");
  });

  it("picks dark text on light hues (yellow, cyan)", () => {
    // Yellow / cyan / lime — luminance > 0.6, expect the dark
    // foreground so the label stays legible against the bright fill.
    expect(labelChipStyle("#eab308").color).toBe("#1a1a1a");
    expect(labelChipStyle("#ffffff").color).toBe("#1a1a1a");
    expect(labelChipStyle("#ffff00").color).toBe("#1a1a1a");
  });

  it("picks light text on dark hues (blue, red)", () => {
    // Blues / reds / saturated pinks — luminance < 0.6, expect
    // white text. These are exactly the kinds of GitHub-style
    // labels where dark text would disappear into the background.
    expect(labelChipStyle("#3b82f6").color).toBe("#ffffff");
    expect(labelChipStyle("#ef4444").color).toBe("#ffffff");
    expect(labelChipStyle("#000000").color).toBe("#ffffff");
  });

  it("threshold cutoff sits at luminance 0.6 (Rec. 601 weights)", () => {
    // Just above the cutoff — Rec. 601 luminance for #cccccc is
    // 0.8, comfortably in the "dark text" zone.
    expect(labelChipStyle("#cccccc").color).toBe("#1a1a1a");
    // Just below — #777777 lands at 0.467, well below 0.6.
    expect(labelChipStyle("#777777").color).toBe("#ffffff");
  });
});

describe("labelChipStyleString", () => {
  it("emits a flat CSS-text string from the resolved style", () => {
    const out = labelChipStyleString("#22c55e");
    expect(out).toContain("background:#22c55e");
    expect(out).toContain("color:#ffffff");
    expect(out).toContain("border-color:");
    // Each declaration ends with ``;`` joined together — a single
    // attribute-style assignment, not a multi-line block.
    expect(out.split("\n")).toHaveLength(1);
  });

  it("emits the neutral palette for nullish / malformed input", () => {
    for (const value of [null, undefined, "", "not-a-color"]) {
      const out = labelChipStyleString(value);
      expect(out).toContain(`background:${NEUTRAL_BG}`);
      expect(out).toContain(`color:${NEUTRAL_FG}`);
    }
  });
});

describe("LABEL_COLOR_SWATCHES", () => {
  it("exposes a non-empty palette of valid #rrggbb hex strings", () => {
    expect(LABEL_COLOR_SWATCHES.length).toBeGreaterThan(0);
    for (const hex of LABEL_COLOR_SWATCHES) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("every swatch resolves to a non-neutral chip style", () => {
    for (const hex of LABEL_COLOR_SWATCHES) {
      const style = labelChipStyle(hex);
      expect(style.background).toBe(hex);
      expect(style.background).not.toBe(NEUTRAL_BG);
    }
  });
});
