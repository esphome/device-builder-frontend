import { describe, expect, it } from "vitest";

import { isFeaturedId } from "../../src/util/featured-id.js";

describe("isFeaturedId", () => {
  it("is true for a featured.<board>.<local> id", () => {
    expect(isFeaturedId("featured.bw15.socket")).toBe(true);
  });

  it("is false for a plain catalog id", () => {
    expect(isFeaturedId("sensor.dht")).toBe(false);
    expect(isFeaturedId("socket")).toBe(false);
  });

  it("requires the trailing dot, not just the word", () => {
    expect(isFeaturedId("featuredthing")).toBe(false);
  });
});
