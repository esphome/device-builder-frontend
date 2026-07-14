/**
 * Coverage for the device-drawer's relative-time helpers.
 *
 * ``formatSecondsAgo`` wraps ``Intl.RelativeTimeFormat`` so the
 * Reachability section's "12 seconds ago" / "2 minutes ago"
 * lines come out localized without per-language strings shipped
 * by us. ``ageOf`` adds the wall-clock since the snapshot anchor
 * onto a backend-supplied baseline so the displayed value
 * advances between server pushes (the drawer ticks 500ms).
 *
 * We pin the locale to ``en`` for stable assertion text — the
 * actual production runtime uses ``navigator.language`` and so
 * picks up the user's chosen locale automatically.
 */
import { describe, expect, it } from "vitest";
import {
  ageOf,
  formatCountdown,
  formatDuration,
  formatSecondsAgo,
  getNumberFormatter,
  remainingOf,
} from "../../src/util/relative-time.js";

describe("formatSecondsAgo", () => {
  it("returns empty string for null / undefined", () => {
    expect(formatSecondsAgo(null, "en")).toBe("");
    expect(formatSecondsAgo(undefined, "en")).toBe("");
  });

  it("renders sub-minute values in seconds", () => {
    // Intl.RelativeTimeFormat with numeric:auto picks "now" for 0,
    // and "X seconds ago" otherwise. The exact "now" wording is
    // locale-specific so we just probe that the unit choice is
    // seconds — i.e. the result mentions "second" or matches
    // "now" (numeric: auto's idiomatic zero shape).
    const now = formatSecondsAgo(0, "en");
    expect(now.toLowerCase()).toMatch(/now|0 seconds/);
    const fifteen = formatSecondsAgo(15, "en");
    expect(fifteen).toMatch(/15.*second/);
  });

  it("rolls into minutes at 60s", () => {
    expect(formatSecondsAgo(59, "en")).toMatch(/second/);
    expect(formatSecondsAgo(60, "en")).toMatch(/minute/);
    expect(formatSecondsAgo(125, "en")).toMatch(/2 minutes? ago/);
  });

  it("rolls into hours at 60 minutes", () => {
    expect(formatSecondsAgo(3599, "en")).toMatch(/minute/);
    expect(formatSecondsAgo(3600, "en")).toMatch(/hour/);
    expect(formatSecondsAgo(7200, "en")).toMatch(/2 hours? ago/);
  });

  it("rolls into days at 24 hours", () => {
    expect(formatSecondsAgo(86399, "en")).toMatch(/hour/);
    expect(formatSecondsAgo(86400, "en")).toMatch(/day/);
    expect(formatSecondsAgo(86400 * 3, "en")).toMatch(/3 days? ago/);
  });

  it("clamps negative input (clock skew) to zero", () => {
    // A backend timestamp that drifted slightly *ahead* of the
    // client clock would produce a negative seconds-ago. We
    // ``Math.max(0, …)`` it so the displayed text is still in
    // the past tense — ``Intl.RelativeTimeFormat`` on a positive
    // value would render "in 5 seconds", which would lie about
    // the freshness.
    const result = formatSecondsAgo(-5, "en");
    expect(result.toLowerCase()).not.toMatch(/in /);
  });

  it("does not crash without a language argument", () => {
    // Production calls with ``navigator.language`` which is
    // always present in browsers, but the helper accepts
    // ``undefined`` for unit-test environments where navigator
    // isn't defined. Falls through to the runtime default.
    expect(() => formatSecondsAgo(30)).not.toThrow();
  });
});

describe("ageOf", () => {
  it("propagates null / undefined baselines", () => {
    expect(ageOf(null, 0, 1000)).toBeNull();
    expect(ageOf(undefined, 0, 1000)).toBeNull();
  });

  it("adds elapsed wall-clock seconds onto the baseline", () => {
    // Snapshot landed at anchor=1_000_000ms reading "20s ago".
    // Now is 5s later — total displayed age should be 25s.
    expect(ageOf(20, 1_000_000, 1_005_000)).toBe(25);
  });

  it("clamps negative elapsed (clock-jump-backwards) to zero", () => {
    // Wall-clock running backwards mustn't shrink the displayed
    // age below the value the backend supplied — that would
    // contradict the "what we just heard from the backend"
    // contract.
    expect(ageOf(20, 1_000_000, 999_000)).toBe(20);
  });

  it("rounds elapsed to the millisecond, not the second", () => {
    // Sub-second precision should flow through; the formatter
    // is responsible for any rounding/bucketing.
    const out = ageOf(10, 1_000_000, 1_000_500);
    expect(out).not.toBeNull();
    expect(out!).toBeCloseTo(10.5, 5);
  });
});

describe("getNumberFormatter", () => {
  it("returns the same instance for the same (locale, fraction-digits)", () => {
    // Pin the memoization so a future change that drops the
    // cache (e.g. switching to ``new Intl.NumberFormat`` on
    // every call) regresses the drawer's per-row, per-tick
    // allocation churn that this cache fixes.
    const a = getNumberFormatter("en", 1);
    const b = getNumberFormatter("en", 1);
    expect(a).toBe(b);
  });

  it("keys on both locale and fraction-digit count", () => {
    const enOne = getNumberFormatter("en", 1);
    const enZero = getNumberFormatter("en", 0);
    const frOne = getNumberFormatter("fr", 1);
    expect(enOne).not.toBe(enZero); // different precision
    expect(enOne).not.toBe(frOne); // different locale
    expect(enZero.format(94.8)).toBe("95");
    expect(enOne.format(94.8)).toBe("94.8");
  });

  it("does not crash without a language argument", () => {
    expect(() => getNumberFormatter(undefined, 0)).not.toThrow();
  });

  it("keys on minimum integer digits", () => {
    const plain = getNumberFormatter("en", 0);
    const padded = getNumberFormatter("en", 0, 2);
    expect(plain).not.toBe(padded);
    expect(padded).toBe(getNumberFormatter("en", 0, 2));
    expect(padded.format(5)).toBe("05");
  });
});

describe("formatDuration", () => {
  it("renders the compact variant by default", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(8 * 60 + 30)).toBe("8m");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(3600 + 14 * 60)).toBe("1h 14m");
  });

  it("keeps the finer unit in the counter variant, padding hour-range minutes", () => {
    expect(formatDuration(45, { variant: "counter" })).toBe("45s");
    expect(formatDuration(4 * 60 + 32, { variant: "counter" })).toBe("4m 32s");
    expect(formatDuration(3600 + 5 * 60, { variant: "counter" })).toBe("1h 05m");
    expect(formatDuration(3600, { variant: "counter" })).toBe("1h 00m");
  });

  it("clamps negative input to zero", () => {
    expect(formatDuration(-5)).toBe("0s");
    expect(formatDuration(-5, { variant: "counter" })).toBe("0s");
  });
});

describe("remainingOf", () => {
  it("returns null for null / undefined baseline", () => {
    expect(remainingOf(null, 0, 1000)).toBeNull();
    expect(remainingOf(undefined, 0, 1000)).toBeNull();
  });

  it("returns the unmodified baseline when anchor equals now", () => {
    expect(remainingOf(120, 1000, 1000)).toBe(120);
  });

  it("subtracts elapsed wall-clock seconds from the baseline", () => {
    // 30 seconds elapsed since the anchor, baseline 120 → 90
    expect(remainingOf(120, 1000, 31000)).toBe(90);
  });

  it("floors at zero rather than going negative", () => {
    // baseline 10s, but 60s elapsed since anchor
    expect(remainingOf(10, 0, 60_000)).toBe(0);
  });

  it("clamps a backwards clock skew at the baseline", () => {
    // anchor in the future would otherwise yield a value larger
    // than the baseline; the clamp at 0 elapsed keeps the
    // displayed countdown bounded above by what the server said.
    expect(remainingOf(120, 5000, 1000)).toBe(120);
  });
});

describe("formatCountdown", () => {
  it("returns empty string for null / undefined", () => {
    expect(formatCountdown(null, "en")).toBe("");
    expect(formatCountdown(undefined, "en")).toBe("");
  });

  it("renders sub-minute values in seconds", () => {
    expect(formatCountdown(0, "en")).toBe("0s");
    expect(formatCountdown(45, "en")).toBe("45s");
    expect(formatCountdown(59.9, "en")).toBe("59s");
  });

  it("renders sub-hour values in whole minutes", () => {
    expect(formatCountdown(60, "en")).toBe("1m");
    expect(formatCountdown(8 * 60 + 30, "en")).toBe("8m");
    expect(formatCountdown(3599, "en")).toBe("59m");
  });

  it("renders hour-plus values as Xh Ym, dropping a zero minute", () => {
    expect(formatCountdown(3600, "en")).toBe("1h");
    expect(formatCountdown(3600 + 14 * 60, "en")).toBe("1h 14m");
    expect(formatCountdown(2 * 3600 + 59, "en")).toBe("2h");
  });

  it("clamps negative input to zero", () => {
    expect(formatCountdown(-5, "en")).toBe("0s");
  });

  it("does not crash without a language argument", () => {
    expect(() => formatCountdown(75)).not.toThrow();
  });
});
