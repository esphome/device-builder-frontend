import { describe, expect, it, vi } from "vitest";

// Loading the module registers an mdi resolver as a side effect; stub the
// webawesome registry so the import doesn't pull the real icon library.
vi.mock("@home-assistant/webawesome/dist/components/icon/library.js", () => ({
  registerIconLibrary: vi.fn(),
}));

import { iconForDomain } from "../../../src/components/device/navigator-row-icons.js";

describe("iconForDomain", () => {
  it("maps script to the script glyph (automation parentKey lookup)", () => {
    expect(iconForDomain("script")).toBe("script-text-outline");
  });

  it("maps known domains to their glyph", () => {
    expect(iconForDomain("sensor")).toBe("gauge");
    expect(iconForDomain("switch")).toBe("toggle-switch-outline");
    expect(iconForDomain("number")).toBe("numeric");
  });

  it("gives the core config/data utilities meaningful glyphs, not the generic cog", () => {
    expect(iconForDomain("substitutions")).toBe("code-braces");
    expect(iconForDomain("packages")).toBe("package-variant-closed");
    expect(iconForDomain("globals")).toBe("variable");
    expect(iconForDomain("external_components")).toBe("puzzle-outline");
    expect(iconForDomain("json")).toBe("code-json");
    // bytebuffer is a byte array, not RAM — distinct from psram's memory glyph.
    expect(iconForDomain("bytebuffer")).toBe("code-array");
    expect(iconForDomain("psram")).toBe("memory");
  });

  it("marks hash/HMAC helpers with the pound-box (#) glyph, not a lock", () => {
    expect(iconForDomain("sha256")).toBe("pound-box-outline");
    expect(iconForDomain("hmac_md5")).toBe("pound-box-outline");
    expect(iconForDomain("hmac_sha256")).toBe("pound-box-outline");
  });

  it("gives preferences a save-settings glyph, distinct from psram's memory", () => {
    expect(iconForDomain("preferences")).toBe("content-save-cog-outline");
    expect(iconForDomain("psram")).toBe("memory");
  });

  it("shares one glyph across related domains", () => {
    expect(iconForDomain("i2c")).toBe(iconForDomain("spi"));
  });

  it("gives the whole bluetooth family the bluetooth glyph", () => {
    const bt = iconForDomain("esp32_ble_tracker");
    expect(bt).toBe("bluetooth");
    for (const d of [
      "bluetooth_proxy",
      "ble_client",
      "ble_nus",
      "esp32_ble_beacon",
      "esp32_ble_server",
    ]) {
      expect(iconForDomain(d)).toBe(bt);
    }
  });

  it("gives 32-bit MCU platforms the cpu-32-bit glyph", () => {
    for (const d of [
      "esp32",
      "esp8266",
      "rp2040",
      "bk72xx",
      "rtl87xx",
      "ln882x",
      "libretiny",
      "nrf52",
    ]) {
      expect(iconForDomain(d)).toBe("cpu-32-bit");
    }
    // The native host platform isn't a 32-bit MCU; it keeps the generic chip.
    expect(iconForDomain("host")).toBe("chip");
  });

  it("maps the newly-filled common components off the fallback", () => {
    expect(iconForDomain("mqtt")).toBe("swap-horizontal");
    expect(iconForDomain("voice_assistant")).toBe("microphone-message");
    expect(iconForDomain("remote_transmitter")).toBe("remote");
    expect(iconForDomain("remote_receiver")).toBe("remote");
    expect(iconForDomain("deep_sleep")).not.toBe("shape-outline");
    // Top-level keys that look like platforms but aren't (own YAML block).
    expect(iconForDomain("esp32_camera")).toBe(iconForDomain("camera"));
    expect(iconForDomain("syslog")).toBe(iconForDomain("logger"));
    expect(iconForDomain("modbus_controller")).toBe(iconForDomain("i2c"));
  });

  it("maps the reported top-level system components", () => {
    // Mostly the docs/header glyph; zwave_proxy keeps the specific z-wave icon.
    expect(iconForDomain("zwave_proxy")).toBe("z-wave");
    expect(iconForDomain("psram")).toBe("memory");
    expect(iconForDomain("runtime_stats")).toBe("chart-line");
    expect(iconForDomain("usb_host")).toBe("usb");
    expect(iconForDomain("usb_uart")).toBe(iconForDomain("usb_host"));
    expect(iconForDomain("gps")).toBe("crosshairs-gps");
    expect(iconForDomain("sprinkler")).toBe("sprinkler-variant");
    expect(iconForDomain("deep_sleep")).toBe("power-sleep");
  });

  it("groups hardware families under a shared glyph", () => {
    expect(iconForDomain("ld2410")).toBe("motion-sensor"); // radar
    expect(iconForDomain("pn532_i2c")).toBe("nfc-variant"); // nfc
    expect(iconForDomain("mcp23017")).toBe("connection"); // io expander
    expect(iconForDomain("tlc5947")).toBe("lightbulb-outline"); // led driver
  });

  it("falls back to a neutral shape for unmapped domains", () => {
    expect(iconForDomain("totally_unknown")).toBe("shape-outline");
    expect(iconForDomain("demo")).toBe("shape-outline"); // long tail stays neutral
  });
});
