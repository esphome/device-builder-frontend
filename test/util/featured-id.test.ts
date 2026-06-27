import { describe, expect, it } from "vitest";

import { isFeaturedId, resolveFeaturedComponentId } from "../../src/util/featured-id.js";

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

describe("resolveFeaturedComponentId", () => {
  const board = {
    id: "esp32-poe-iso",
    featured_components: [{ id: "onboard_ethernet", component_id: "ethernet" }],
  };

  it("resolves a featured id to its underlying component_id", () => {
    expect(
      resolveFeaturedComponentId("featured.esp32-poe-iso.onboard_ethernet", board)
    ).toBe("ethernet");
  });

  it("passes a non-featured id through", () => {
    expect(resolveFeaturedComponentId("sensor.dht", board)).toBe("sensor.dht");
  });

  it("passes an unknown featured id or null board through unchanged", () => {
    expect(resolveFeaturedComponentId("featured.esp32-poe-iso.unknown", board)).toBe(
      "featured.esp32-poe-iso.unknown"
    );
    expect(resolveFeaturedComponentId("featured.x.y", null)).toBe("featured.x.y");
  });
});
