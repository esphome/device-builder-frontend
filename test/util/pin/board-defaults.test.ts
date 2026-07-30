import { describe, expect, it } from "vitest";
import { makeConfigEntry } from "../_make-config-entry.js";
import type { BoardCatalogEntry, BoardPin } from "../../../src/api/types/boards.js";
import {
  type ConfigEntry,
  ConfigEntryType,
} from "../../../src/api/types/config-entries.js";
import { seedBoardPinDefaults } from "../../../src/util/pin/board-defaults.js";

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

const NO_USED_PINS = new Map<number | string, string>();

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
    const result = seedBoardPinDefaults(
      "i2c",
      i2cEntries,
      makeBoard(c3Pins),
      { id: "i2c_1" },
      NO_USED_PINS
    );
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
      { id: "i2c_1", scl: 5 },
      NO_USED_PINS
    );
    // sda still seeded; scl untouched.
    expect(result).toEqual({ id: "i2c_1", scl: 5, sda: 8 });
  });

  it("returns input unchanged when board is null", () => {
    const result = seedBoardPinDefaults(
      "i2c",
      i2cEntries,
      null,
      { id: "i2c_1" },
      NO_USED_PINS
    );
    expect(result).toEqual({ id: "i2c_1" });
  });

  it("returns input unchanged when board has no pins", () => {
    const result = seedBoardPinDefaults(
      "i2c",
      i2cEntries,
      makeBoard([]),
      { id: "i2c_1" },
      NO_USED_PINS
    );
    expect(result).toEqual({ id: "i2c_1" });
  });

  it("falls through silently when board has no matching feature", () => {
    // Board with pins but no i2c_* features (ESP32-C3 missing the tag).
    const board = makeBoard([
      makePin({ gpio: 0, features: ["adc"] }),
      makePin({ gpio: 1, features: ["adc"] }),
    ]);
    const result = seedBoardPinDefaults(
      "i2c",
      i2cEntries,
      board,
      { id: "i2c_1" },
      NO_USED_PINS
    );
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
      {},
      NO_USED_PINS
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
      { pin: "GPIO12" }, // catalog preset already in values
      NO_USED_PINS
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
      {},
      NO_USED_PINS
    );
    expect(result).toEqual({});
  });

  it("seeds uart tx_pin/rx_pin by stripping the _pin suffix (issue #601)", () => {
    // Real uart entries are ``tx_pin`` / ``rx_pin``; board manifests
    // tag pins ``uart_tx`` / ``uart_rx``. The role normalization (strip
    // a trailing ``_pin`` / ``_gpio``) bridges the two, so the defaults
    // seed instead of silently falling through.
    const board = makeBoard([
      makePin({ gpio: 20, features: ["uart_rx"] }),
      makePin({ gpio: 21, features: ["uart_tx"] }),
    ]);
    const result = seedBoardPinDefaults(
      "uart",
      [
        makeEntry({ key: "rx_pin", default_value: "GPIO3" }),
        makeEntry({ key: "tx_pin", default_value: "GPIO1" }),
      ],
      board,
      {},
      NO_USED_PINS
    );
    expect(result).toEqual({ rx_pin: 20, tx_pin: 21 });
  });

  it("matches a bare role key and a _gpio suffix too", () => {
    // ``sda``/``scl`` (no suffix) and ``*_gpio`` both normalize to the
    // same role-shaped tag the manifest uses.
    const board = makeBoard([
      makePin({ gpio: 20, features: ["uart_rx"] }),
      makePin({ gpio: 21, features: ["uart_tx"] }),
    ]);
    const result = seedBoardPinDefaults(
      "uart",
      [
        makeEntry({ key: "rx", default_value: "GPIO3" }), // bare role
        makeEntry({ key: "tx_gpio", default_value: "GPIO1" }), // _gpio suffix
      ],
      board,
      {},
      NO_USED_PINS
    );
    expect(result).toEqual({ rx: 20, tx_gpio: 21 });
  });

  it("leaves the field unset when every tagged pin is occupied (issue #1555)", () => {
    // Second uart on a board with one uart_rx/uart_tx pair: the first
    // bus already wires 20/21, and no other tagged pin exists, so
    // seeding them again would just manufacture a "used in multiple
    // places" error on submit.
    const board = makeBoard([
      makePin({ gpio: 20, features: ["uart_rx"] }),
      makePin({ gpio: 21, features: ["uart_tx"] }),
    ]);
    const result = seedBoardPinDefaults(
      "uart",
      [
        makeEntry({ key: "rx_pin", default_value: "GPIO3" }),
        makeEntry({ key: "tx_pin", default_value: "GPIO1" }),
      ],
      board,
      {},
      new Map([
        [20, "uart"],
        [21, "uart"],
      ])
    );
    // Left for the user to wire — no value at all, not a warned one.
    expect(result).toEqual({});
  });

  it("seeds the free pin when only one of the pair is occupied", () => {
    const board = makeBoard([
      makePin({ gpio: 20, features: ["uart_rx"] }),
      makePin({ gpio: 21, features: ["uart_tx"] }),
    ]);
    const result = seedBoardPinDefaults(
      "uart",
      [
        makeEntry({ key: "rx_pin", default_value: "GPIO3" }),
        makeEntry({ key: "tx_pin", default_value: "GPIO1" }),
      ],
      board,
      {},
      new Map([[20, "switch"]])
    );
    expect(result).toEqual({ tx_pin: 21 });
  });

  it("suggests the next workable uart pair when the board tags two", () => {
    const board = makeBoard([
      makePin({ gpio: 44, features: ["uart_rx"] }),
      makePin({ gpio: 43, features: ["uart_tx"] }),
      makePin({ gpio: 18, features: ["uart_rx"] }),
      makePin({ gpio: 17, features: ["uart_tx"] }),
    ]);
    const result = seedBoardPinDefaults(
      "uart",
      [
        makeEntry({ key: "rx_pin", default_value: "GPIO3" }),
        makeEntry({ key: "tx_pin", default_value: "GPIO1" }),
      ],
      board,
      {},
      new Map([
        [44, "uart"],
        [43, "uart"],
      ])
    );
    expect(result).toEqual({ rx_pin: 18, tx_pin: 17 });
  });

  it("never seeds one GPIO for two roles in the same pass", () => {
    // A pin tagged with both roles must not resolve for both entries —
    // that would recreate the duplicate-pin error on submit. First
    // entry wins by loop order; the second falls through or stays
    // unset.
    const board = makeBoard([
      makePin({ gpio: 8, features: ["i2c_sda", "i2c_scl"] }),
      makePin({ gpio: 9, features: ["i2c_scl"] }),
    ]);
    const result = seedBoardPinDefaults(
      "i2c",
      [
        makeEntry({ key: "sda", default_value: "SDA" }),
        makeEntry({ key: "scl", default_value: "SCL" }),
      ],
      board,
      {},
      NO_USED_PINS
    );
    expect(result).toEqual({ sda: 8, scl: 9 });
  });

  it("falls through to the next free tagged pin (second i2c bus)", () => {
    // wesp32 shape: i2c_sda / i2c_scl tagged on several pins. A second
    // bus skips the pair the first bus wired and suggests the next
    // workable pair by manifest order.
    const board = makeBoard([
      makePin({ gpio: 21, features: ["pwm", "i2c_sda"] }),
      makePin({ gpio: 22, features: ["pwm", "i2c_scl"] }),
      makePin({ gpio: 15, features: ["touch", "i2c_sda"] }),
      makePin({ gpio: 4, features: ["adc", "i2c_scl"] }),
    ]);
    const result = seedBoardPinDefaults(
      "i2c",
      [
        makeEntry({ key: "sda", default_value: "SDA" }),
        makeEntry({ key: "scl", default_value: "SCL" }),
      ],
      board,
      {},
      new Map([
        [21, "i2c"],
        [22, "i2c"],
      ])
    );
    expect(result).toEqual({ sda: 15, scl: 4 });
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
      {},
      NO_USED_PINS
    );
    expect(result).toEqual({ sda: 8 });
  });
});
