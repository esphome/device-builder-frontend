import { describe, expect, it } from "vitest";
import { mdnsExpiryRemaining, mdnsExpirySummary } from "../../src/util/mdns-expiry.js";

describe("mdnsExpiryRemaining", () => {
  it("counts down past the quiet threshold", () => {
    expect(mdnsExpiryRemaining(300, 4500, false)).toBe(4200);
  });

  it("shows no hint when fresh, offline, or without a TTL", () => {
    expect(mdnsExpiryRemaining(60, 4500, false)).toBeNull();
    expect(mdnsExpiryRemaining(300, 4500, true)).toBeNull();
    expect(mdnsExpiryRemaining(300, null, false)).toBeNull();
    expect(mdnsExpiryRemaining(null, 4500, false)).toBeNull();
  });

  it("clamps an already-elapsed record to zero", () => {
    expect(mdnsExpiryRemaining(5000, 4500, false)).toBe(0);
  });
});

describe("mdnsExpirySummary", () => {
  it("mirrors the drawer's countdown text", () => {
    expect(mdnsExpirySummary(300, 4500, false)).toBe("Expires in 1h 10m");
  });

  it("says soon at the eviction edge", () => {
    expect(mdnsExpirySummary(4500, 4500, false)).toBe("Expires soon");
  });

  it("answers the no-row and no-countdown cases", () => {
    expect(mdnsExpirySummary(null, 4500, false)).toBe("no mDNS row");
    expect(mdnsExpirySummary(60, 4500, false)).toBe(
      "no expiry countdown (heard recently)"
    );
    expect(mdnsExpirySummary(300, 4500, true)).toBe(
      "no expiry countdown (device offline)"
    );
  });
});
