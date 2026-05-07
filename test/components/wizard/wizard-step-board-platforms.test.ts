import { describe, expect, it } from "vitest";
import { WIZARD_BOARD_PLATFORMS } from "../../../src/components/wizard/wizard-step-board-platforms.js";

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
