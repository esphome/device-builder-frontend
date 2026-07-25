/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import type { LocalizeFunc } from "../../src/common/localize.js";
import {
  serialConsoleMismatch,
  serialPortCannotCarryConsole,
} from "../../src/util/serial-console-match.js";

const ESP_JTAG = { usbVendorId: 0x303a, usbProductId: 0x1001 };
const ESP_USB_BRIDGE = { usbVendorId: 0x303a, usbProductId: 0x1002 };
const CH340 = { usbVendorId: 0x1a86, usbProductId: 0x7523 };
const PICO = { usbVendorId: 0x2e8a, usbProductId: 0x0005 };

function port(info: SerialPortInfo): SerialPort {
  return { getInfo: () => info } as unknown as SerialPort;
}

describe("serialPortCannotCarryConsole", () => {
  it.each(["USB_SERIAL_JTAG", "USB_CDC"])(
    "the on-chip USB device carries a %s console",
    (iface) => {
      expect(serialPortCannotCarryConsole(iface, port(ESP_JTAG))).toBe(false);
    }
  );

  it.each([
    ["1a86", 0x1a86],
    ["10c4", 0x10c4],
    ["0403", 0x0403],
    ["067b", 0x067b],
  ])(
    "a dedicated bridge chip (vendor 0x%s) cannot carry a native-USB console",
    (_hex, vendor) => {
      // The #1430 heat-pump shape: C3 logger on USB_SERIAL_JTAG, user
      // watching through an external UART bridge.
      expect(
        serialPortCannotCarryConsole(
          "USB_SERIAL_JTAG",
          port({ usbVendorId: vendor, usbProductId: 0x1 })
        )
      ).toBe(true);
    }
  );

  it("a bridge chip carries a UART console", () => {
    expect(serialPortCannotCarryConsole("UART0", port(CH340))).toBe(false);
  });

  it.each(["UART0", "UART1", "UART2", "UART0_SWAP"])(
    "the on-chip USB-Serial-JTAG device cannot carry a %s console",
    (iface) => {
      expect(serialPortCannotCarryConsole(iface, port(ESP_JTAG))).toBe(true);
    }
  );

  it("fails open for a native CDC console on a non-Espressif chip (Pico)", () => {
    // RP2040 / nRF52 native USB_CDC enumerate under their own vendors; an
    // unknown vendor must never be mistaken for a bridge.
    expect(serialPortCannotCarryConsole("USB_CDC", port(PICO))).toBe(false);
  });

  it("fails open for a port with no USB identity", () => {
    expect(serialPortCannotCarryConsole("USB_CDC", port({}))).toBe(false);
    expect(serialPortCannotCarryConsole("UART0", port({}))).toBe(false);
  });

  it("fails open for the ESP-USB-Bridge (0x303a but not the on-chip device)", () => {
    expect(serialPortCannotCarryConsole("UART0", port(ESP_USB_BRIDGE))).toBe(false);
    expect(serialPortCannotCarryConsole("USB_SERIAL_JTAG", port(ESP_USB_BRIDGE))).toBe(
      false
    );
  });

  it("unknown interface never claims a mismatch", () => {
    expect(serialPortCannotCarryConsole(null, port(CH340))).toBe(false);
    expect(serialPortCannotCarryConsole(undefined, port(ESP_JTAG))).toBe(false);
    expect(serialPortCannotCarryConsole("", port(CH340))).toBe(false);
    // An interface name outside both known families fails open too, even on
    // the port that would mismatch a UART console.
    expect(serialPortCannotCarryConsole("SOMETHING_NEW", port(ESP_JTAG))).toBe(false);
  });
});

describe("serialConsoleMismatch", () => {
  const localize = ((key: string, params?: Record<string, string>) =>
    params ? `${key}:${params.interface}` : key) as unknown as LocalizeFunc;

  it("names the interface in the wrong-port notice", () => {
    expect(serialConsoleMismatch("USB_SERIAL_JTAG", port(CH340), localize)).toEqual({
      message: "dashboard.logs_serial_wrong_port_fallback:USB_SERIAL_JTAG",
    });
  });

  it("stays truthy even when localization produces an empty string", () => {
    const empty = (() => "") as unknown as LocalizeFunc;
    expect(serialConsoleMismatch("USB_SERIAL_JTAG", port(CH340), empty)).toBeTruthy();
  });

  it("is null when the port can carry the console (or is uncertain)", () => {
    expect(serialConsoleMismatch("UART0", port(CH340), localize)).toBeNull();
    expect(serialConsoleMismatch(null, port(CH340), localize)).toBeNull();
    expect(serialConsoleMismatch("USB_CDC", port(PICO), localize)).toBeNull();
  });
});
