/**
 * @vitest-environment happy-dom
 *
 * web.esphome.io's families, read by the header, the dashboard, the mode URL
 * and the flow-switch toast: each one's copy exists, and a port's USB ids
 * point at the right family (or none).
 */
import { describe, expect, it } from "vitest";

import "../../_mock-webawesome.js";

import { makeUsbPort as port } from "../_make-web-serial-port.js";
import { english } from "../../_en-json.js";
import {
  DEFAULT_WEB_MODE,
  WEB_PLATFORMS,
  webPlatform,
  webPlatformOfPort,
} from "../../../src/web/platforms/registry.js";

const familyOf = (p: SerialPort) => webPlatformOfPort(p)?.mode ?? null;

describe("WEB_PLATFORMS", () => {
  it("has one entry per mode, the first being ESP, the default", () => {
    const modes = WEB_PLATFORMS.map((p) => p.mode);
    expect(new Set(modes).size).toBe(modes.length);
    expect(DEFAULT_WEB_MODE).toBe("esp");
  });

  it.each(WEB_PLATFORMS.map((p) => [p.mode, p] as const))(
    "%s has English copy for its header, intro and flow switch",
    (mode, platform) => {
      const keys = [platform.labelKey, platform.introKey];
      if (platform.flowSwitch) {
        keys.push(platform.flowSwitch.messageKey, platform.flowSwitch.actionKey);
      }
      for (const key of keys) {
        expect(english(key), `missing en.json key "${key}"`).toBeTruthy();
      }
      expect(webPlatform(mode)).toBe(platform);
    }
  );
});

describe("webPlatformOfPort", () => {
  it("reads a Pico's own console from the Raspberry Pi vendor id", () => {
    expect(familyOf(port(0x2e8a, 0xf00a))).toBe("pico");
  });

  it("does not take a Raspberry Pi debug probe for a Pico", () => {
    expect(familyOf(port(0x2e8a, 0x000c))).toBeNull();
  });

  it("reads an nRF52 running ESPHome, which enumerates as a Zephyr USB device", () => {
    expect(familyOf(port(0x2fe3, 0x0100))).toBe("nrf");
  });

  it("reads the known nRF52 boards, and Nordic's own id outright", () => {
    expect(familyOf(port(0x239a, 0x8029))).toBe("nrf");
    expect(familyOf(port(0x239a, 0x0029))).toBe("nrf");
    expect(familyOf(port(0x1915, 0x520f))).toBe("nrf");
    expect(familyOf(port(0x2886, 0x8045))).toBe("nrf");
  });

  it("stays silent for Adafruit's or Seeed's other boards", () => {
    // Feather RP2040 under arduino-pico, a tinyuf2 ESP32-S3 bootloader.
    expect(familyOf(port(0x239a, 0x80f1))).toBeNull();
    expect(familyOf(port(0x239a, 0x0110))).toBeNull();
    expect(familyOf(port(0x2886, 0x802f))).toBeNull();
  });

  it("reads an Espressif native-USB device as the ESP flow", () => {
    expect(familyOf(port(0x303a, 0x1001))).toBe("esp");
  });

  it("says nothing for a UART bridge, which fronts an ESP as readily as an RTL8720C", () => {
    expect(familyOf(port(0x1a86, 0x7523))).toBeNull();
    expect(familyOf(port(0x10c4, 0xea60))).toBeNull();
  });

  it("says nothing for an unknown vendor or a non-USB port", () => {
    expect(familyOf(port(0x1366, 0x1015))).toBeNull();
    expect(familyOf(port())).toBeNull();
  });
});
