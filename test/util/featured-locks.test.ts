import { describe, expect, it } from "vitest";

import type { BoardCatalogEntry } from "../../src/api/types/boards.js";
import { ConfigEntryType } from "../../src/api/types/config-entries.js";
import { overlayBoardLockedPresets } from "../../src/util/featured-locks.js";
import { makeConfigEntry } from "./_make-config-entry.js";

const preset = (value: unknown, locked = true) => ({ value, locked, suggestions: null });

const BOARD = {
  id: "apollo-esk-1",
  featured_components: [
    {
      id: "onboard_rgb_led",
      component_id: "light.esp32_rmt_led_strip",
      fields: {
        id: preset("onboard_rgb_led", false),
        name: preset("Onboard RGB LED", false),
        pin: preset(5),
        chipset: preset("WS2812"),
        num_leds: preset(1),
      },
    },
  ],
} as unknown as BoardCatalogEntry;

const ENTRIES = [
  makeConfigEntry({ key: "chipset", type: ConfigEntryType.STRING }),
  makeConfigEntry({ key: "num_leds", type: ConfigEntryType.INTEGER }),
  makeConfigEntry({ key: "name", type: ConfigEntryType.STRING }),
  makeConfigEntry({ key: "pin", type: ConfigEntryType.PIN }),
];

const SECTION = "light.esp32_rmt_led_strip";

const VALUES = { id: "onboard_rgb_led", chipset: "WS2812", num_leds: 1, pin: 5 };

describe("overlayBoardLockedPresets", () => {
  it("locks a matching instance's locked presets with the guard reason", () => {
    const out = overlayBoardLockedPresets(ENTRIES, BOARD, SECTION, VALUES);
    const chipset = out.find((e) => e.key === "chipset")!;
    expect(chipset.locked).toBe(true);
    expect((chipset as { locked_reason_key?: string }).locked_reason_key).toBe(
      "device.pin_wiring_guard_tooltip"
    );
    // Soft preset stays editable.
    expect(out.find((e) => e.key === "name")!.locked).toBeFalsy();
  });

  it("matches a scalar loosely across YAML round-trips", () => {
    const out = overlayBoardLockedPresets(ENTRIES, BOARD, SECTION, {
      ...VALUES,
      num_leds: "1",
    });
    expect(out.find((e) => e.key === "num_leds")!.locked).toBe(true);
  });

  it("releases a value the user moved off the preset", () => {
    const out = overlayBoardLockedPresets(ENTRIES, BOARD, SECTION, {
      ...VALUES,
      num_leds: 30,
    });
    expect(out.find((e) => e.key === "num_leds")!.locked).toBeFalsy();
    expect(out.find((e) => e.key === "chipset")!.locked).toBe(true);
  });

  it("ignores an instance whose id doesn't match the featured entry", () => {
    const out = overlayBoardLockedPresets(ENTRIES, BOARD, SECTION, {
      ...VALUES,
      id: "my_own_strip",
    });
    expect(out).toBe(ENTRIES);
  });

  it("never stamps a PIN entry (the picker guard owns pins)", () => {
    const out = overlayBoardLockedPresets(ENTRIES, BOARD, SECTION, VALUES);
    expect(out.find((e) => e.key === "pin")!.locked).toBeFalsy();
  });

  it("passes an already-locked entry through with its own reason", () => {
    // The add dialog's server-hydrated entries arrive locked; the overlay
    // must not re-stamp them with the guard reason.
    const serverLocked = makeConfigEntry({
      key: "chipset",
      type: ConfigEntryType.STRING,
      locked: true,
    });
    const out = overlayBoardLockedPresets([serverLocked], BOARD, SECTION, VALUES);
    expect(out[0]).toBe(serverLocked);
  });

  it("returns the input array untouched outside the section", () => {
    expect(overlayBoardLockedPresets(ENTRIES, BOARD, "switch.gpio", VALUES)).toBe(
      ENTRIES
    );
  });

  it("hands back stable locked copies across renders", () => {
    const a = overlayBoardLockedPresets(ENTRIES, BOARD, SECTION, VALUES);
    const b = overlayBoardLockedPresets(ENTRIES, BOARD, SECTION, VALUES);
    expect(a.find((e) => e.key === "chipset")).toBe(b.find((e) => e.key === "chipset"));
  });
});
