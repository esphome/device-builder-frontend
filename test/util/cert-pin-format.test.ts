import { describe, expect, it } from "vitest";
import { formatPinSha256 } from "../../src/util/cert-pin-format.js";

describe("formatPinSha256", () => {
  it("splits a 64-char hex pin into 32 space-separated byte pairs", () => {
    const pin = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const formatted = formatPinSha256(pin);
    // 32 pairs → 31 spaces → 32 + 31 = 63 chars longer than the
    // input divided by groups: pin is 64 chars; output is
    // "ab cd ..." = 64 + 31 = 95 chars.
    expect(formatted.length).toBe(64 + 31);
    expect(formatted.split(" ")).toEqual([
      "ab",
      "cd",
      "ef",
      "01",
      "23",
      "45",
      "67",
      "89",
      "ab",
      "cd",
      "ef",
      "01",
      "23",
      "45",
      "67",
      "89",
      "ab",
      "cd",
      "ef",
      "01",
      "23",
      "45",
      "67",
      "89",
      "ab",
      "cd",
      "ef",
      "01",
      "23",
      "45",
      "67",
      "89",
    ]);
  });

  it("returns an empty string for empty input", () => {
    expect(formatPinSha256("")).toBe("");
  });

  it("matches the backend's ``DashboardIdentity.pin_sha256_formatted`` shape", () => {
    // Pin the spec the backend uses (see
    // helpers/dashboard_identity.py:pin_sha256_formatted) so
    // a divergence between frontend display and what the
    // receiver renders on its own card surfaces here at unit-
    // test time. The user's OOB-verification step is
    // "compare what the sender saw to what the receiver
    // says"; if these two lines disagree on spacing /
    // grouping the user can't compare them.
    const pin = "deadbeefcafebabe1234567890abcdef".repeat(2); // 64 chars
    const expected =
      "de ad be ef ca fe ba be 12 34 56 78 90 ab cd ef " +
      "de ad be ef ca fe ba be 12 34 56 78 90 ab cd ef";
    expect(formatPinSha256(pin)).toBe(expected);
  });

  it("handles odd-length input by emitting a trailing single char", () => {
    // Defensive: a malformed pin shouldn't crash the formatter.
    // The Settings card surfaces invalid pins via a separate
    // "couldn't load identity" error path, but we still return
    // something stable here so a debug print of the raw pin
    // doesn't throw.
    expect(formatPinSha256("abc")).toBe("ab c");
  });
});
