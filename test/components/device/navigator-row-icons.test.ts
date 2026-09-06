import {
  mdiBluetooth,
  mdiChartLine,
  mdiChip,
  mdiCodeArray,
  mdiCodeBraces,
  mdiCodeJson,
  mdiConnection,
  mdiContentSaveCogOutline,
  mdiCpu32Bit,
  mdiCrosshairsGps,
  mdiGauge,
  mdiLightbulbOutline,
  mdiMemory,
  mdiMicrophoneMessage,
  mdiMotionSensor,
  mdiNfcVariant,
  mdiNumeric,
  mdiPackageVariantClosed,
  mdiPoundBoxOutline,
  mdiPowerSleep,
  mdiPuzzleOutline,
  mdiRemote,
  mdiScriptTextOutline,
  mdiShapeOutline,
  mdiSpeaker,
  mdiSprinklerVariant,
  mdiSwapHorizontal,
  mdiToggleSwitchOutline,
  mdiUsb,
  mdiVariable,
  mdiZWave,
} from "@mdi/js";
import { describe, expect, it } from "vitest";

import { iconPathForDomain } from "../../../src/components/device/navigator-row-icons.js";

describe("iconPathForDomain", () => {
  it("maps script to the script glyph (automation parentKey lookup)", () => {
    expect(iconPathForDomain("script")).toBe(mdiScriptTextOutline);
  });

  it("maps known domains to their glyph", () => {
    expect(iconPathForDomain("sensor")).toBe(mdiGauge);
    expect(iconPathForDomain("switch")).toBe(mdiToggleSwitchOutline);
    expect(iconPathForDomain("number")).toBe(mdiNumeric);
  });

  it("gives the core config/data utilities meaningful glyphs, not the generic cog", () => {
    expect(iconPathForDomain("substitutions")).toBe(mdiCodeBraces);
    expect(iconPathForDomain("packages")).toBe(mdiPackageVariantClosed);
    expect(iconPathForDomain("globals")).toBe(mdiVariable);
    expect(iconPathForDomain("external_components")).toBe(mdiPuzzleOutline);
    expect(iconPathForDomain("json")).toBe(mdiCodeJson);
    // bytebuffer is a byte array, not RAM — distinct from psram's memory glyph.
    expect(iconPathForDomain("bytebuffer")).toBe(mdiCodeArray);
    expect(iconPathForDomain("psram")).toBe(mdiMemory);
  });

  it("marks hash/HMAC helpers with the pound-box (#) glyph, not a lock", () => {
    expect(iconPathForDomain("sha256")).toBe(mdiPoundBoxOutline);
    expect(iconPathForDomain("hmac_md5")).toBe(mdiPoundBoxOutline);
    expect(iconPathForDomain("hmac_sha256")).toBe(mdiPoundBoxOutline);
  });

  it("gives preferences a save-settings glyph, distinct from psram's memory", () => {
    expect(iconPathForDomain("preferences")).toBe(mdiContentSaveCogOutline);
    expect(iconPathForDomain("psram")).toBe(mdiMemory);
  });

  it("shares one glyph across related domains", () => {
    expect(iconPathForDomain("i2c")).toBe(iconPathForDomain("spi"));
  });

  it("gives the whole bluetooth family the bluetooth glyph", () => {
    expect(iconPathForDomain("esp32_ble_tracker")).toBe(mdiBluetooth);
    for (const d of [
      "bluetooth_proxy",
      "ble_client",
      "ble_nus",
      "esp32_ble_beacon",
      "esp32_ble_server",
    ]) {
      expect(iconPathForDomain(d)).toBe(mdiBluetooth);
    }
  });

  it("gives 32-bit MCU platforms the cpu-32-bit glyph", () => {
    for (const d of [
      "esp32",
      "esp8266",
      "rp2040",
      // the deprecated rp2040 spelling of the rp2 platform (esphome#17145)
      "rp2",
      "bk72xx",
      "rtl87xx",
      "ln882x",
      "libretiny",
      "nrf52",
    ]) {
      expect(iconPathForDomain(d)).toBe(mdiCpu32Bit);
    }
    // The native host platform isn't a 32-bit MCU; it keeps the generic chip.
    expect(iconPathForDomain("host")).toBe(mdiChip);
  });

  it("maps the newly-filled common components off the fallback", () => {
    expect(iconPathForDomain("mqtt")).toBe(mdiSwapHorizontal);
    expect(iconPathForDomain("voice_assistant")).toBe(mdiMicrophoneMessage);
    expect(iconPathForDomain("remote_transmitter")).toBe(mdiRemote);
    expect(iconPathForDomain("remote_receiver")).toBe(mdiRemote);
    expect(iconPathForDomain("deep_sleep")).not.toBe(mdiShapeOutline);
    expect(iconPathForDomain("speaker")).toBe(mdiSpeaker);
    // Top-level keys that look like platforms but aren't (own YAML block).
    expect(iconPathForDomain("esp32_camera")).toBe(iconPathForDomain("camera"));
    expect(iconPathForDomain("syslog")).toBe(iconPathForDomain("logger"));
    expect(iconPathForDomain("modbus_controller")).toBe(iconPathForDomain("i2c"));
  });

  it("maps the reported top-level system components", () => {
    // Mostly the docs/header glyph; zwave_proxy keeps the specific z-wave icon.
    expect(iconPathForDomain("zwave_proxy")).toBe(mdiZWave);
    expect(iconPathForDomain("psram")).toBe(mdiMemory);
    expect(iconPathForDomain("runtime_stats")).toBe(mdiChartLine);
    expect(iconPathForDomain("usb_host")).toBe(mdiUsb);
    expect(iconPathForDomain("usb_uart")).toBe(iconPathForDomain("usb_host"));
    expect(iconPathForDomain("gps")).toBe(mdiCrosshairsGps);
    expect(iconPathForDomain("sprinkler")).toBe(mdiSprinklerVariant);
    expect(iconPathForDomain("deep_sleep")).toBe(mdiPowerSleep);
  });

  it("groups hardware families under a shared glyph", () => {
    expect(iconPathForDomain("ld2410")).toBe(mdiMotionSensor); // radar
    expect(iconPathForDomain("pn532_i2c")).toBe(mdiNfcVariant); // nfc
    expect(iconPathForDomain("mcp23017")).toBe(mdiConnection); // io expander
    expect(iconPathForDomain("tlc5947")).toBe(mdiLightbulbOutline); // led driver
  });

  it("falls back to a neutral shape for unmapped domains", () => {
    expect(iconPathForDomain("totally_unknown")).toBe(mdiShapeOutline);
    expect(iconPathForDomain("demo")).toBe(mdiShapeOutline); // long tail stays neutral
  });
});
