import { describe, expect, it } from "vitest";
import {
  WIZARD_BOARD_PLATFORMS,
  chipNameToFilterLabel,
} from "../../../src/components/wizard/wizard-step-board-platforms.js";

describe("wizard step-board platform chips", () => {
  it("includes an LN882x chip backed by the ln882x platform", () => {
    // Without this chip, users with LightLink LN882x hardware
    // had to scroll the OTHER BOARDS list to find their board.
    // The backend's `_PLATFORM_KEYS` already advertises
    // `ln882x`, so the FE chip just resolves to a real query.
    const ln882x = WIZARD_BOARD_PLATFORMS.find((p) => p.label === "LN882x");
    expect(ln882x).toBeDefined();
    expect(ln882x?.platform).toBe("ln882x");
    expect(ln882x?.variant).toBe("");
  });

  it("includes an nRF52 chip backed by the nrf52 platform", () => {
    // Backend `_PLATFORM_KEYS` advertises `nrf52` as a
    // first-class platform alongside the libretiny chips.
    // Even when the curated catalog has zero `nrf52`
    // manifests today, the chip's presence tells users with
    // nRF52 hardware that their platform is supported and
    // saves them scrolling OTHER BOARDS for nothing — entries
    // land here as the catalog grows.
    const nrf52 = WIZARD_BOARD_PLATFORMS.find((p) => p.label === "nRF52");
    expect(nrf52).toBeDefined();
    expect(nrf52?.platform).toBe("nrf52");
    expect(nrf52?.variant).toBe("");
  });

  it("labels the rp2040 platform 'RP2040 / RP2350' so users searching for either chip name see it", () => {
    // ESPHome's `rp2040` platform key covers both the original
    // RP2040 and the newer RP2350 (Raspberry Pi Pico 2). A plain
    // "RP2040" label hides the filter from anyone searching for
    // their RP2350 board. The platform key stays `rp2040` —
    // this is a label-only contract.
    const labels = WIZARD_BOARD_PLATFORMS.map((p) => p.label);
    expect(labels).toContain("RP2040 / RP2350");
    expect(labels).not.toContain("RP2040");
    const rp = WIZARD_BOARD_PLATFORMS.find((p) => p.label === "RP2040 / RP2350");
    expect(rp?.platform).toBe("rp2040");
  });

  it("groups the libretiny-family chips (BK72xx / RTL87xx / LN882x) adjacent", () => {
    // The three libretiny-based platforms sit next to each
    // other so the user scanning the chip row sees them as a
    // family. A regression that re-orders them into different
    // positions wouldn't break functionality but would hurt
    // discoverability — pin the ordering.
    const labels = WIZARD_BOARD_PLATFORMS.map((p) => p.label);
    const bk = labels.indexOf("BK72xx");
    const rtl = labels.indexOf("RTL87xx");
    const ln = labels.indexOf("LN882x");
    expect(bk).toBeGreaterThanOrEqual(0);
    expect(rtl).toBe(bk + 1);
    expect(ln).toBe(rtl + 1);
  });

  describe("chipNameToFilterLabel", () => {
    it("maps an esptool-js chip name with package + revision suffix to the variant label", () => {
      // esptool-js returns names like "ESP32-C6 (QFN32) (revision v0.2)".
      // The function must strip everything from the first `(` onward
      // before matching, otherwise the variant lookup misses.
      expect(chipNameToFilterLabel("ESP32-C6 (QFN32) (revision v0.2)")).toBe("ESP32-C6");
    });

    it("maps every ESP32 variant to its filter label", () => {
      // Sanity-check the variant column of WIZARD_BOARD_PLATFORMS round-trips
      // through the chip-name → label normalisation. Catches accidental
      // renames in either the catalog or the parser.
      expect(chipNameToFilterLabel("ESP32")).toBe("ESP32");
      expect(chipNameToFilterLabel("ESP32-S2")).toBe("ESP32-S2");
      expect(chipNameToFilterLabel("ESP32-S3")).toBe("ESP32-S3");
      expect(chipNameToFilterLabel("ESP32-C3")).toBe("ESP32-C3");
      expect(chipNameToFilterLabel("ESP32-H2")).toBe("ESP32-H2");
    });

    it("maps a platform-only chip (variant === '') via the platform fallback", () => {
      // ESP8266 / RP2040 / BK72xx / RTL87xx / LN882x / nRF52 don't have
      // variants in WIZARD_BOARD_PLATFORMS — the function must fall back
      // to a platform match when the variant lookup misses.
      expect(chipNameToFilterLabel("ESP8266")).toBe("ESP8266");
      expect(chipNameToFilterLabel("RP2040")).toBe("RP2040 / RP2350");
    });

    it("returns null for a chip name with no matching platform or variant", () => {
      // An unknown chip name shouldn't yield a misleading filter; the
      // caller treats null as "no filter, show the full picker".
      expect(chipNameToFilterLabel("FooBar")).toBeNull();
      expect(chipNameToFilterLabel("STM32F4")).toBeNull();
    });

    it("normalises case and dashes so lowercase / unconventional inputs still match", () => {
      // The normalisation strips dashes and lowercases — protects against
      // upstream chip-name format drift (older esptool versions, custom
      // ROMs that lowercase the chip name, etc.).
      expect(chipNameToFilterLabel("esp32-c6")).toBe("ESP32-C6");
      expect(chipNameToFilterLabel("ESP32C6")).toBe("ESP32-C6");
    });
  });

  it("every chip's platform is in the backend's accepted set", () => {
    // The backend's `_PLATFORM_KEYS` (helpers/device_yaml.py)
    // restricts `platform:` to a fixed set. A chip whose
    // `platform` field falls outside that set would query the
    // catalog with a string the backend has no boards for and
    // the chip would always come up empty.
    const accepted = new Set([
      "esp32",
      "esp8266",
      "rp2040",
      "bk72xx",
      "rtl87xx",
      "ln882x",
      "nrf52",
    ]);
    for (const p of WIZARD_BOARD_PLATFORMS) {
      expect(accepted.has(p.platform)).toBe(true);
    }
  });
});
