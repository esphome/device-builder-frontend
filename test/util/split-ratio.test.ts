import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SPLIT_RATIO,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  clampSplitRatio,
  loadSplitRatio,
  nextSplitRatioForKey,
  saveSplitRatio,
} from "../../src/util/split-ratio.js";

describe("split-ratio", () => {
  // Mirrors the auth-token.test.ts pattern: vitest runs in node, so
  // localStorage has to be stubbed per-test.
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("clampSplitRatio", () => {
    it("clamps below the minimum", () => {
      expect(clampSplitRatio(0.1)).toBe(MIN_SPLIT_RATIO);
      expect(clampSplitRatio(-5)).toBe(MIN_SPLIT_RATIO);
    });

    it("clamps above the maximum", () => {
      expect(clampSplitRatio(0.9)).toBe(MAX_SPLIT_RATIO);
      expect(clampSplitRatio(42)).toBe(MAX_SPLIT_RATIO);
    });

    it("passes a value inside the band through unchanged", () => {
      expect(clampSplitRatio(0.5)).toBe(0.5);
      expect(clampSplitRatio(MIN_SPLIT_RATIO)).toBe(MIN_SPLIT_RATIO);
      expect(clampSplitRatio(MAX_SPLIT_RATIO)).toBe(MAX_SPLIT_RATIO);
    });
  });

  describe("loadSplitRatio", () => {
    it("falls back to the default when nothing is stored", () => {
      expect(loadSplitRatio()).toBe(DEFAULT_SPLIT_RATIO);
    });

    it("falls back to the default for an empty or garbage value", () => {
      localStorage.setItem("esphome-editor-split-ratio", "");
      expect(loadSplitRatio()).toBe(DEFAULT_SPLIT_RATIO);
      localStorage.setItem("esphome-editor-split-ratio", "not-a-number");
      expect(loadSplitRatio()).toBe(DEFAULT_SPLIT_RATIO);
    });

    it("clamps an out-of-band stored value", () => {
      localStorage.setItem("esphome-editor-split-ratio", "0.95");
      expect(loadSplitRatio()).toBe(MAX_SPLIT_RATIO);
      localStorage.setItem("esphome-editor-split-ratio", "0.0");
      expect(loadSplitRatio()).toBe(MIN_SPLIT_RATIO);
    });

    it("round-trips a valid ratio through save/load", () => {
      saveSplitRatio(0.6);
      expect(loadSplitRatio()).toBe(0.6);
    });
  });

  it("tolerates localStorage throwing on read and write", () => {
    // Private mode / sandboxed iframes can throw on every access.
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
      clear: () => {
        throw new Error("blocked");
      },
    });
    expect(() => saveSplitRatio(0.6)).not.toThrow();
    expect(loadSplitRatio()).toBe(DEFAULT_SPLIT_RATIO);
  });

  describe("nextSplitRatioForKey", () => {
    it("nudges left/right by one step", () => {
      expect(nextSplitRatioForKey(0.5, "ArrowLeft")).toBeCloseTo(0.48);
      expect(nextSplitRatioForKey(0.5, "ArrowRight")).toBeCloseTo(0.52);
    });

    it("jumps to the band ends on Home/End", () => {
      expect(nextSplitRatioForKey(0.5, "Home")).toBe(MIN_SPLIT_RATIO);
      expect(nextSplitRatioForKey(0.5, "End")).toBe(MAX_SPLIT_RATIO);
    });

    it("clamps when stepping past an end", () => {
      expect(nextSplitRatioForKey(MIN_SPLIT_RATIO, "ArrowLeft")).toBe(MIN_SPLIT_RATIO);
      expect(nextSplitRatioForKey(MAX_SPLIT_RATIO, "ArrowRight")).toBe(MAX_SPLIT_RATIO);
    });

    it("returns null for a non-resize key", () => {
      expect(nextSplitRatioForKey(0.5, "Enter")).toBeNull();
      expect(nextSplitRatioForKey(0.5, "a")).toBeNull();
    });
  });
});
