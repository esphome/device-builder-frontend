import { describe, expect, it } from "vitest";
import { mdnsExpiresSoon, mdnsExpiryRemaining } from "../../src/util/mdns-expiry.js";

describe("mdnsExpiryRemaining", () => {
  it("counts down past the quiet threshold", () => {
    expect(mdnsExpiryRemaining(300, 4500, false, "mdns")).toBe(4200);
  });

  it("shows no hint when fresh, offline, inactive, or without a TTL", () => {
    expect(mdnsExpiryRemaining(60, 4500, false, "mdns")).toBeNull();
    expect(mdnsExpiryRemaining(300, 4500, true, "mdns")).toBeNull();
    expect(mdnsExpiryRemaining(300, 4500, false, "ping")).toBeNull();
    expect(mdnsExpiryRemaining(300, null, false, "mdns")).toBeNull();
    expect(mdnsExpiryRemaining(null, 4500, false, "mdns")).toBeNull();
  });

  it("clamps an already-elapsed record to zero", () => {
    expect(mdnsExpiryRemaining(5000, 4500, false, "mdns")).toBe(0);
  });
});

describe("mdnsExpiresSoon", () => {
  it("cuts at one second", () => {
    expect(mdnsExpiresSoon(0)).toBe(true);
    expect(mdnsExpiresSoon(0.9)).toBe(true);
    expect(mdnsExpiresSoon(1)).toBe(false);
  });
});
