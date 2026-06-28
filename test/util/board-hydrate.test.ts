import { describe, expect, it } from "vitest";
import type {
  BoardCatalogEntry,
  PagedBoardsResponse,
} from "../../src/api/types/boards.js";
import {
  hydrateBoard,
  hydratePagedBoardsResponse,
} from "../../src/util/board-hydrate.js";

/**
 * Stripped wire shape: the keys the backend's omit_default
 * config drops on serialise. Each call-site verifies hydrateBoard
 * fills the matching default exactly the way Python's from_dict
 * would, so consumers can read non-null fields without `?? []`
 * defensive accesses on every site.
 */
function strippedEntry(): Record<string, unknown> {
  return {
    id: "esp32_devkit_v1",
    name: "ESP32 DevKit v1",
    description: "Generic ESP32 development kit",
    manufacturer: "Espressif",
    esphome: { platform: "esp32", board: "esp32dev" },
    // hardware / images / tags / pins / docs_url / product_url
    // / featured / is_generic / featured_components /
    // featured_bundles all OMITTED by the strip — hydrator must
    // fill them.
  };
}

describe("hydrateBoard", () => {
  it("re-defaults every omitted top-level field", () => {
    const entry = strippedEntry() as unknown as BoardCatalogEntry;
    const hydrated = hydrateBoard(entry);
    expect(hydrated.hardware).toEqual({
      flash_size: null,
      ram_size: null,
      cpu_frequency: null,
      connectivity: [],
    });
    expect(hydrated.images).toEqual([]);
    expect(hydrated.tags).toEqual([]);
    expect(hydrated.pins).toEqual([]);
    expect(hydrated.docs_url).toBe("");
    expect(hydrated.product_url).toBe("");
    expect(hydrated.featured).toBe(false);
    expect(hydrated.is_generic).toBe(false);
    expect(hydrated.featured_components).toEqual([]);
    expect(hydrated.featured_bundles).toEqual([]);
  });

  it("re-defaults variant + framework on a stripped esphome block", () => {
    const entry = strippedEntry() as unknown as BoardCatalogEntry;
    const hydrated = hydrateBoard(entry);
    expect(hydrated.esphome.variant).toBeNull();
    expect(hydrated.esphome.framework).toBeNull();
  });

  it("re-defaults nested FieldPreset values (locked/false, suggestions/null)", () => {
    // Mirrors the highest-frequency strip surface: ~40k empty
    // suggestions + locked false rows live inside FeaturedComponent.fields
    // on a fully-populated catalog.
    const entry = {
      ...strippedEntry(),
      featured_components: [
        {
          id: "led",
          component_id: "output.gpio",
          // name, description omitted (would be null)
          fields: {
            pin: { value: 5 },
            inverted: { value: true, locked: true },
            // suggestions / locked default-fields all omitted
          },
        },
      ],
    } as unknown as BoardCatalogEntry;
    const hydrated = hydrateBoard(entry);
    const fc = hydrated.featured_components[0];
    expect(fc.name).toBeNull();
    expect(fc.description).toBeNull();
    expect(fc.fields.pin).toEqual({ value: 5, locked: false, suggestions: null });
    expect(fc.fields.inverted).toEqual({
      value: true,
      locked: true,
      suggestions: null,
    });
  });

  it("re-defaults BoardPin fields when the pin row is partially stripped", () => {
    const entry = {
      ...strippedEntry(),
      pins: [
        // Only gpio supplied — everything else stripped.
        { gpio: 13 },
      ],
    } as unknown as BoardCatalogEntry;
    const [pin] = hydrateBoard(entry).pins;
    expect(pin).toEqual({
      gpio: 13,
      label: "",
      features: [],
      available: null,
      occupied_by: null,
      notes: null,
    });
  });

  it("re-defaults a stripped FeaturedBundle's description + component_ids", () => {
    const entry = {
      ...strippedEntry(),
      featured_bundles: [{ id: "status_led", name: "Status LED" }],
    } as unknown as BoardCatalogEntry;
    const [fb] = hydrateBoard(entry).featured_bundles;
    expect(fb.description).toBe("");
    expect(fb.component_ids).toEqual([]);
  });

  it("preserves unknown fields the backend may add later (forward-compat)", () => {
    // Each helper spreads its input before applying defaults, so
    // wire fields the hydrator doesn't know about pass through
    // instead of being silently dropped.
    const entry = {
      ...strippedEntry(),
      future_top_level: "kept",
      hardware: { flash_size: "4 MB", future_hw_field: 42 },
      featured_components: [
        {
          id: "led",
          component_id: "output.gpio",
          future_fc_field: "kept",
          fields: {
            pin: { value: 5, future_preset_field: ["kept"] },
          },
        },
      ],
      featured_bundles: [{ id: "sl", name: "Status LED", future_bundle_field: true }],
      pins: [{ gpio: 13, future_pin_field: "kept" }],
      esphome: {
        platform: "esp32",
        board: "esp32dev",
        future_esphome_field: "kept",
      },
    } as unknown as BoardCatalogEntry;
    const hydrated = hydrateBoard(entry) as unknown as Record<string, unknown>;
    expect(hydrated.future_top_level).toBe("kept");
    expect((hydrated.hardware as Record<string, unknown>).future_hw_field).toBe(42);
    expect((hydrated.esphome as Record<string, unknown>).future_esphome_field).toBe(
      "kept"
    );
    const [pin] = hydrated.pins as Record<string, unknown>[];
    expect(pin.future_pin_field).toBe("kept");
    const [fc] = hydrated.featured_components as Record<string, unknown>[];
    expect(fc.future_fc_field).toBe("kept");
    const preset = (fc.fields as Record<string, Record<string, unknown>>).pin;
    expect(preset.future_preset_field).toEqual(["kept"]);
    const [fb] = hydrated.featured_bundles as Record<string, unknown>[];
    expect(fb.future_bundle_field).toBe(true);
  });

  it("preserves populated fields", () => {
    // A non-stripped board (every default explicitly set on the wire)
    // round-trips unchanged.
    const entry: BoardCatalogEntry = {
      id: "esp32_devkit_v1",
      name: "ESP32 DevKit v1",
      description: "Generic ESP32 development kit",
      manufacturer: "Espressif",
      esphome: {
        platform: "esp32",
        board: "esp32dev",
        variant: "esp32",
        framework: "arduino",
        mcu: null,
      },
      hardware: {
        flash_size: "4 MB",
        ram_size: 320,
        cpu_frequency: "240 MHz",
        connectivity: ["wifi", "bluetooth"],
      },
      images: ["image.png"],
      tags: ["development"],
      pins: [
        {
          gpio: 13,
          label: "LED",
          features: ["digital"],
          available: true,
          occupied_by: null,
          notes: "Built-in",
        },
      ],
      docs_url: "https://example.com",
      product_url: "https://shop.example.com",
      featured: true,
      is_generic: false,
      full_config: false,
      featured_components: [],
      featured_bundles: [],
      requires_wifi: false,
    };
    expect(hydrateBoard(entry)).toEqual(entry);
  });
});

describe("hydratePagedBoardsResponse", () => {
  it("hydrates every board in the response", () => {
    const response = {
      total: 1,
      offset: 0,
      limit: 50,
      boards: [strippedEntry()],
    } as unknown as PagedBoardsResponse;
    const hydrated = hydratePagedBoardsResponse(response);
    expect(hydrated.boards).toHaveLength(1);
    expect(hydrated.boards[0].pins).toEqual([]);
    expect(hydrated.boards[0].docs_url).toBe("");
    // Top-level paging fields pass through.
    expect(hydrated.total).toBe(1);
    expect(hydrated.offset).toBe(0);
    expect(hydrated.limit).toBe(50);
  });

  it("re-defaults a wholly-stripped wrapper (forward-compat against omit_default on PagedResponse)", () => {
    // If the backend ever applies omit_default to PagedResponse,
    // a zero-result query strips boards/total/offset/limit — the
    // .map would throw and pagination would surface as undefined.
    // Pin the defensive defaults.
    const response = {} as unknown as PagedBoardsResponse;
    const hydrated = hydratePagedBoardsResponse(response);
    expect(hydrated.boards).toEqual([]);
    expect(hydrated.total).toBe(0);
    expect(hydrated.offset).toBe(0);
    expect(hydrated.limit).toBe(50);
  });
});
