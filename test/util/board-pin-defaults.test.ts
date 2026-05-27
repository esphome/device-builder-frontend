import { describe, expect, it } from "vitest";
import {
  ConfigEntryType,
  type BoardCatalogEntry,
  type BoardPin,
  type ConfigEntry,
} from "../../src/api/types.js";
import { seedBoardPinDefaults } from "../../src/util/board-pin-defaults.js";
import { makeConfigEntry } from "./_make-config-entry.js";

function makePin(overrides: Partial<BoardPin>): BoardPin {
  return {
    gpio: 0,
    label: "",
    features: [],
    available: null,
    occupied_by: null,
    notes: null,
    ...overrides,
  };
}

function makeBoard(pins: BoardPin[]): BoardCatalogEntry {
  return {
    id: "esp32-c3-devkitm-1",
    name: "",
    description: "",
    manufacturer: "",
    esphome: { platform: "esp32", board: "esp32-c3-devkitm-1" } as never,
    hardware: {
      flash_size: null,
      ram_size: null,
      cpu_frequency: null,
      connectivity: [],
    },
    images: [],
    tags: [],
    pins,
    docs_url: "",
    product_url: "",
    featured: false,
    is_generic: false,
    featured_components: [],
    featured_bundles: [],
  };
}

// PIN-typed default + empty label match the original local helper —
// the shared one defaults to STRING/"Foo", so callers pass overrides
// here to keep behaviour identical.
function makeEntry(overrides: Partial<ConfigEntry> = {}): ConfigEntry {
  return makeConfigEntry({ type: ConfigEntryType.PIN, label: "", ...overrides });
}

describe("seedBoardPinDefaults", () => {
  // Original ESP32-C3 i2c repro shape: GPIO8 tagged i2c_sda, GPIO9
  // tagged i2c_scl. The bus's catalog entry has scl/sda PIN entries
  // with symbolic defaults ("SCL" / "SDA") that don't resolve on C3.
  const c3Pins = [
    makePin({ gpio: 8, label: "GPIO8", features: ["pwm", "i2c_sda"] }),
    makePin({ gpio: 9, label: "GPIO9", features: ["pwm", "i2c_scl"] }),
  ];
  const i2cEntries = [
    makeEntry({ key: "scl", default_value: "SCL" }),
    makeEntry({ key: "sda", default_value: "SDA" }),
    makeEntry({ key: "id", type: ConfigEntryType.ID }),
    makeEntry({
      key: "frequency",
      type: ConfigEntryType.FLOAT,
      default_value: "50kHz",
    }),
  ];

  it("seeds matching pins from board manifest features", () => {
    const result = seedBoardPinDefaults("i2c", i2cEntries, makeBoard(c3Pins), {
      id: "i2c_1",
    });
    // GPIO8 is tagged i2c_sda → sda entry gets 8.
    // GPIO9 is tagged i2c_scl → scl entry gets 9.
    expect(result).toEqual({ id: "i2c_1", scl: 9, sda: 8 });
  });

  it("doesn't override values the user already provided", () => {
    const result = seedBoardPinDefaults(
      "i2c",
      i2cEntries,
      makeBoard(c3Pins),
      // User typed scl manually before clicking Add.
      { id: "i2c_1", scl: 5 }
    );
    // sda still seeded; scl untouched.
    expect(result).toEqual({ id: "i2c_1", scl: 5, sda: 8 });
  });

  it("returns input unchanged when board is null", () => {
    const result = seedBoardPinDefaults("i2c", i2cEntries, null, {
      id: "i2c_1",
    });
    expect(result).toEqual({ id: "i2c_1" });
  });

  it("returns input unchanged when board has no pins", () => {
    const result = seedBoardPinDefaults("i2c", i2cEntries, makeBoard([]), {
      id: "i2c_1",
    });
    expect(result).toEqual({ id: "i2c_1" });
  });

  it("falls through silently when board has no matching feature", () => {
    // Board with pins but no i2c_* features (ESP32-C3 missing the tag).
    const board = makeBoard([
      makePin({ gpio: 0, features: ["adc"] }),
      makePin({ gpio: 1, features: ["adc"] }),
    ]);
    const result = seedBoardPinDefaults("i2c", i2cEntries, board, {
      id: "i2c_1",
    });
    // No seeding — user picks pins manually via the form.
    expect(result).toEqual({ id: "i2c_1" });
  });

  it("skips platform-qualified component ids", () => {
    // ``audio_adc.es7210`` etc. — entity components whose pin
    // defaults aren't peripheral feature tags. Skip rather than
    // misroute (e.g. ``audio_adc_es7210_din`` would never match
    // anything in the manifest).
    const result = seedBoardPinDefaults(
      "audio_adc.es7210",
      [makeEntry({ key: "din", default_value: "GPIO4" })],
      makeBoard([makePin({ gpio: 4, features: ["adc"] })]),
      {}
    );
    expect(result).toEqual({});
  });

  it("skips featured-component ids (their presets win)", () => {
    // Featured components use ``featured.<board>.<local>`` ids —
    // they include ``.`` so the platform-qualified-id skip catches
    // them. Featured components carry their own per-pin presets
    // (locked / suggested values from the board manifest); we must
    // not override those with a generic peripheral-feature lookup
    // because the featured preset is more specific (e.g. a
    // PIR-on-FPC-connector preset that pins a particular GPIO).
    const result = seedBoardPinDefaults(
      "featured.athom-smart-plug-v3.relay",
      [makeEntry({ key: "pin", default_value: "GPIO12" })],
      makeBoard([makePin({ gpio: 8, features: ["i2c_sda"] })]),
      { pin: "GPIO12" } // catalog preset already in values
    );
    // No change — preset stays put.
    expect(result).toEqual({ pin: "GPIO12" });
  });

  it("only seeds PIN-typed entries, not other types", () => {
    // A board pin tagged i2c_frequency wouldn't make sense, but if
    // the manifest had it, the seeder must NOT touch a FLOAT entry.
    const board = makeBoard([makePin({ gpio: 8, features: ["i2c_frequency"] })]);
    const result = seedBoardPinDefaults(
      "i2c",
      [
        makeEntry({
          key: "frequency",
          type: ConfigEntryType.FLOAT,
          default_value: "50kHz",
        }),
      ],
      board,
      {}
    );
    expect(result).toEqual({});
  });

  it("seeds uart rx/tx the same way as i2c scl/sda", () => {
    // The mechanism is component-agnostic: any bus-like bare id
    // composes ``<componentId>_<entryKey>`` and looks it up.
    const board = makeBoard([
      makePin({ gpio: 20, features: ["uart_rx"] }),
      makePin({ gpio: 21, features: ["uart_tx"] }),
    ]);
    const result = seedBoardPinDefaults(
      "uart",
      [
        makeEntry({ key: "rx_pin", default_value: "GPIO3" }),
        makeEntry({ key: "tx_pin", default_value: "GPIO1" }),
        makeEntry({ key: "rx", default_value: "GPIO3" }),
        makeEntry({ key: "tx", default_value: "GPIO1" }),
      ],
      board,
      {}
    );
    // Only entries whose key matches the suffix after ``uart_`` get
    // seeded — ``rx`` and ``tx``. Mismatched keys (``rx_pin``,
    // ``tx_pin``) fall through.
    expect(result).toEqual({ rx: 20, tx: 21 });
  });

  it("uses the FIRST matching pin when multiple are tagged", () => {
    // If the board manifest tags two pins as i2c_sda (some boards
    // expose multiple i2c-capable pins), we pick the first by
    // manifest order. Pinning this so a refactor that flips to
    // last-wins doesn't change the user-visible default.
    const board = makeBoard([
      makePin({ gpio: 8, features: ["i2c_sda"] }),
      makePin({ gpio: 18, features: ["i2c_sda"] }),
    ]);
    const result = seedBoardPinDefaults(
      "i2c",
      [makeEntry({ key: "sda", default_value: "SDA" })],
      board,
      {}
    );
    expect(result).toEqual({ sda: 8 });
  });
});
