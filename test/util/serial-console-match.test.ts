import { describe, expect, it } from "vitest";
import { serialPortCannotCarryConsole } from "../../src/util/serial-console-match.js";

const ESPRESSIF = 0x303a;
const CH340 = 0x1a86;

function port(usbVendorId?: number): SerialPort {
  return { getInfo: () => ({ usbVendorId }) } as unknown as SerialPort;
}

describe("serialPortCannotCarryConsole", () => {
  it.each(["USB_SERIAL_JTAG", "USB_CDC"])(
    "native Espressif port carries a %s console",
    (iface) => {
      expect(serialPortCannotCarryConsole(iface, port(ESPRESSIF))).toBe(false);
    }
  );

  it.each(["UART0", "UART1", "UART2", "UART0_SWAP"])(
    "native Espressif port cannot carry a %s console",
    (iface) => {
      expect(serialPortCannotCarryConsole(iface, port(ESPRESSIF))).toBe(true);
    }
  );

  it("bridge port cannot carry a native-USB console (the #1430 heat-pump case)", () => {
    expect(serialPortCannotCarryConsole("USB_SERIAL_JTAG", port(CH340))).toBe(true);
    expect(serialPortCannotCarryConsole("USB_CDC", port(CH340))).toBe(true);
  });

  it("bridge port carries a UART console", () => {
    expect(serialPortCannotCarryConsole("UART0", port(CH340))).toBe(false);
  });

  it("a port with no USB identity counts as a bridge", () => {
    expect(serialPortCannotCarryConsole("USB_CDC", port(undefined))).toBe(true);
    expect(serialPortCannotCarryConsole("UART0", port(undefined))).toBe(false);
  });

  it("unknown interface never claims a mismatch", () => {
    expect(serialPortCannotCarryConsole(null, port(CH340))).toBe(false);
    expect(serialPortCannotCarryConsole(undefined, port(ESPRESSIF))).toBe(false);
    expect(serialPortCannotCarryConsole("", port(CH340))).toBe(false);
  });
});
