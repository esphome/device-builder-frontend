import { describe, expect, it } from "vitest";
import { boardFamilyOfPort } from "../../src/web/util/board-family.js";
import { makeUsbPort as port } from "./_make-web-serial-port.js";

describe("boardFamilyOfPort", () => {
  it("reads a Pico's own console from the Raspberry Pi vendor id", () => {
    expect(boardFamilyOfPort(port(0x2e8a, 0xf00a))).toBe("pico");
  });

  it("does not take a Raspberry Pi debug probe for a Pico", () => {
    expect(boardFamilyOfPort(port(0x2e8a, 0x000c))).toBeNull();
  });

  it("reads the known nRF52 vendors", () => {
    expect(boardFamilyOfPort(port(0x239a, 0x8029))).toBe("nrf");
    expect(boardFamilyOfPort(port(0x1915, 0x520f))).toBe("nrf");
    expect(boardFamilyOfPort(port(0x2886, 0x8045))).toBe("nrf");
  });

  it("reads an Espressif native-USB device or a UART bridge as the ESP flow", () => {
    expect(boardFamilyOfPort(port(0x303a, 0x1001))).toBe("esp");
    expect(boardFamilyOfPort(port(0x10c4, 0xea60))).toBe("esp");
    expect(boardFamilyOfPort(port(0x1a86, 0x55d4))).toBe("esp");
  });

  it("says nothing for an unknown vendor or a non-USB port", () => {
    expect(boardFamilyOfPort(port(0x1366, 0x1015))).toBeNull();
    expect(boardFamilyOfPort(port())).toBeNull();
  });
});
