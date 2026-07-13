import { describe, expect, it } from "vitest";
import {
  formatAbsoluteTime,
  formatElapsed,
  formatRelativeTime,
  parseIsoMs,
} from "../../src/util/format-job-time.js";

const NOW = new Date("2026-05-01T14:00:00Z").getTime();

describe("formatRelativeTime", () => {
  it("renders seconds in the past", () => {
    const iso = new Date(NOW - 30 * 1000).toISOString();
    expect(formatRelativeTime(iso, NOW, "en")).toBe("30 seconds ago");
  });

  it("renders minutes in the past", () => {
    const iso = new Date(NOW - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(iso, NOW, "en")).toBe("5 minutes ago");
  });

  it("renders hours in the past", () => {
    const iso = new Date(NOW - 3 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(iso, NOW, "en")).toBe("3 hours ago");
  });

  it("renders days in the past", () => {
    const iso = new Date(NOW - 4 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(iso, NOW, "en")).toBe("4 days ago");
  });

  it("uses 'now' phrasing for sub-second deltas", () => {
    expect(formatRelativeTime(new Date(NOW).toISOString(), NOW, "en")).toBe("now");
  });
});

describe("parseIsoMs", () => {
  it("parses an ISO timestamp to epoch ms", () => {
    expect(parseIsoMs("2026-05-01T14:00:00Z")).toBe(NOW);
  });

  it("returns null for nullish or unparseable input (old jobs lack the field)", () => {
    expect(parseIsoMs(null)).toBeNull();
    expect(parseIsoMs(undefined)).toBeNull();
    expect(parseIsoMs("")).toBeNull();
    expect(parseIsoMs("not-a-date")).toBeNull();
  });
});

describe("formatElapsed", () => {
  it("renders sub-minute durations in seconds", () => {
    expect(formatElapsed(45 * 1000)).toBe("45s");
  });

  it("renders minutes and seconds", () => {
    expect(formatElapsed((4 * 60 + 32) * 1000)).toBe("4m 32s");
  });

  it("renders hours and zero-padded minutes", () => {
    expect(formatElapsed((1 * 3600 + 5 * 60) * 1000)).toBe("1h 05m");
  });

  it("clamps negative deltas to zero", () => {
    expect(formatElapsed(-1000)).toBe("0s");
  });

  it("forwards the language for locale-aware digits", () => {
    expect(formatElapsed((4 * 60 + 32) * 1000, "en")).toBe("4m 32s");
    // Arabic-Egypt shapes digits as Arabic-Indic numerals.
    expect(formatElapsed(45 * 1000, "ar-EG")).toBe("\u0664\u0665s");
  });
});

describe("formatAbsoluteTime", () => {
  it("drops the date for same-day timestamps", () => {
    const iso = new Date("2026-05-01T13:32:00Z").toISOString();
    // Hour/minute output depends on the test runner's tz; just assert
    // it has the HH:MM shape and no month abbreviation.
    const out = formatAbsoluteTime(iso, NOW, "en-US");
    expect(out).toMatch(/^\d{1,2}:\d{2}(\s?(AM|PM))?$/);
  });

  it("includes month/day for older timestamps", () => {
    const iso = new Date("2026-04-28T13:32:00Z").toISOString();
    const out = formatAbsoluteTime(iso, NOW, "en-US");
    expect(out).toMatch(/^[A-Z][a-z]{2}\s\d{1,2}\s\d{1,2}:\d{2}(\s?(AM|PM))?$/);
  });
});
