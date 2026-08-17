import { describe, expect, it } from "vitest";

import type { BoardCatalogEntry } from "../../src/api/types/boards.js";
import {
  featuredEntryForInstance,
  isFeaturedId,
  resolveFeaturedComponentId,
} from "../../src/util/featured-id.js";

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

describe("featuredEntryForInstance", () => {
  const preset = (value: unknown) => ({ value, locked: false, suggestions: null });
  const board = {
    id: "board",
    featured_components: [
      {
        id: "lcd_spi",
        component_id: "spi",
        fields: { id: preset("lcd_spi") },
      },
      {
        id: "onboard_ethernet",
        component_id: "ethernet",
        fields: { type: preset("LAN8720") },
      },
    ],
  } as unknown as BoardCatalogEntry;

  it("matches an id-preset entry only on the exact instance id", () => {
    expect(featuredEntryForInstance(board, "spi", "lcd_spi")?.id).toBe("lcd_spi");
    expect(featuredEntryForInstance(board, "spi", "my_own_spi")).toBeNull();
    expect(featuredEntryForInstance(board, "spi", undefined)).toBeNull();
  });

  it("matches an id-less entry by section alone", () => {
    expect(featuredEntryForInstance(board, "ethernet", undefined)?.id).toBe(
      "onboard_ethernet"
    );
    expect(featuredEntryForInstance(board, "ethernet", "eth0")?.id).toBe(
      "onboard_ethernet"
    );
  });

  it("returns null outside the section or without a board", () => {
    expect(featuredEntryForInstance(board, "wifi", undefined)).toBeNull();
    expect(featuredEntryForInstance(null, "ethernet", undefined)).toBeNull();
  });

  it("prefers an exact id match over an id-less sibling", () => {
    const mixed = {
      id: "board",
      featured_components: [
        { id: "generic", component_id: "spi", fields: {} },
        { id: "lcd_spi", component_id: "spi", fields: { id: preset("lcd_spi") } },
      ],
    } as unknown as BoardCatalogEntry;
    expect(featuredEntryForInstance(mixed, "spi", "lcd_spi")?.id).toBe("lcd_spi");
    expect(featuredEntryForInstance(mixed, "spi", "other")?.id).toBe("generic");
  });
});
