import { describe, expect, it } from "vitest";
import { mdnsExpiryPhase } from "../../src/util/mdns-expiry.js";

describe("mdnsExpiryPhase", () => {
  it("counts down past the quiet threshold", () => {
    expect(mdnsExpiryPhase(300, 4500, false, "mdns")).toEqual({
      kind: "countdown",
      remaining: 4200,
      ttl: 4500,
    });
  });

  it("names why no hint shows, in priority order", () => {
    expect(mdnsExpiryPhase(null, 4500, true, "ping")).toEqual({ kind: "no-signal" });
    expect(mdnsExpiryPhase(300, 4500, true, "ping")).toEqual({ kind: "offline" });
    expect(mdnsExpiryPhase(300, 4500, false, "ping")).toEqual({
      kind: "inactive-source",
    });
    expect(mdnsExpiryPhase(300, null, false, "mdns")).toEqual({ kind: "no-ttl" });
    expect(mdnsExpiryPhase(60, 4500, false, "mdns")).toEqual({ kind: "fresh" });
  });

  it("says soon for an already-elapsed record", () => {
    expect(mdnsExpiryPhase(4500, 4500, false, "mdns")).toEqual({
      kind: "soon",
      ttl: 4500,
    });
    expect(mdnsExpiryPhase(5000, 4500, false, "mdns")).toEqual({
      kind: "soon",
      ttl: 4500,
    });
  });
});
