import { describe, expect, it } from "vitest";

import { mayCarryEsp, portFamily } from "../../src/platforms/port-family.js";
import { makeUsbPort as port } from "../web/_make-web-serial-port.js";

describe("portFamily", () => {
  it("names a board by its own USB ids, and nothing else", () => {
    expect(portFamily(port(0x303a, 0x1001))).toBe("esp"); // ESP32-S3 USB-JTAG
    expect(portFamily(port(0x303a, 0x0002))).toBe("esp"); // ESP32-S2 ROM CDC
    expect(portFamily(port(0x2e8a, 0xf00a))).toBe("rp2"); // Pico W
    expect(portFamily(port(0x2fe3, 0x0100))).toBe("nrf52"); // Zephyr CDC
    expect(portFamily(port(0x239a, 0x8029))).toBe("nrf52"); // Feather nRF52840
    // A UART bridge fronts anything; a debug probe is not a Pico; an unknown
    // native-USB device and an id-less port are nobody's.
    expect(portFamily(port(0x1a86, 0x7523))).toBeUndefined();
    expect(portFamily(port(0x303a, 0x1002))).toBeUndefined(); // ESP-USB-Bridge
    expect(portFamily(port(0x2e8a, 0x000c))).toBeUndefined();
    expect(portFamily(port(0x2341, 0x8036))).toBeUndefined();
    expect(portFamily(port())).toBeUndefined();
  });
});

describe("mayCarryEsp", () => {
  it("is Espressif's own USB, a UART bridge, or a port with no ids to go by", () => {
    expect(mayCarryEsp(port(0x303a, 0x1001))).toBe(true);
    expect(mayCarryEsp(port(0x303a, 0x1002))).toBe(true);
    expect(mayCarryEsp(port(0x1a86, 0x7523))).toBe(true);
    expect(mayCarryEsp(port(0x10c4, 0xea60))).toBe(true);
    expect(mayCarryEsp(port())).toBe(true);
  });

  it("is not another board's own console", () => {
    expect(mayCarryEsp(port(0x2e8a, 0xf00a))).toBe(false);
    expect(mayCarryEsp(port(0x2fe3, 0x0100))).toBe(false);
    expect(mayCarryEsp(port(0x2341, 0x8036))).toBe(false);
  });
});
