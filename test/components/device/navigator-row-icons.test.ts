import { describe, expect, it, vi } from "vitest";

// Loading the module registers an mdi resolver as a side effect; stub the
// webawesome registry so the import doesn't pull the real icon library.
vi.mock("@home-assistant/webawesome/dist/components/icon/library.js", () => ({
  registerIconLibrary: vi.fn(),
}));

import { iconForDomain } from "../../../src/components/device/navigator-row-icons.js";

describe("iconForDomain", () => {
  it("maps known domains to their glyph", () => {
    expect(iconForDomain("sensor")).toBe("gauge");
    expect(iconForDomain("switch")).toBe("toggle-switch-outline");
    expect(iconForDomain("number")).toBe("numeric");
  });

  it("shares one glyph across related domains", () => {
    expect(iconForDomain("mdns")).toBe(iconForDomain("ethernet"));
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

  it("gives board platforms the chip glyph", () => {
    expect(iconForDomain("esp32")).toBe(iconForDomain("esphome"));
    expect(iconForDomain("esp8266")).toBe("chip");
    expect(iconForDomain("rp2040")).toBe("chip");
  });

  it("maps the newly-filled common components off the fallback", () => {
    expect(iconForDomain("mqtt")).toBe("swap-horizontal");
    expect(iconForDomain("voice_assistant")).toBe("microphone-message");
    expect(iconForDomain("remote_transmitter")).toBe(iconForDomain("remote_receiver"));
    expect(iconForDomain("deep_sleep")).not.toBe("shape-outline");
    // Top-level keys that look like platforms but aren't (own YAML block).
    expect(iconForDomain("esp32_camera")).toBe(iconForDomain("camera"));
    expect(iconForDomain("syslog")).toBe(iconForDomain("logger"));
    expect(iconForDomain("modbus_controller")).toBe(iconForDomain("i2c"));
  });

  it("falls back to a neutral shape for unmapped domains", () => {
    expect(iconForDomain("totally_unknown")).toBe("shape-outline");
    expect(iconForDomain("mcp23017")).toBe("shape-outline"); // long tail stays neutral
  });
});
