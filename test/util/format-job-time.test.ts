import { describe, expect, it } from "vitest";
import {
  formatAbsoluteTime,
  formatRelativeTime,
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
