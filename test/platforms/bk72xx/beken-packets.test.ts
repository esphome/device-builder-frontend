import { describe, expect, it } from "vitest";
import {
  type BekenCommand,
  checkCrc,
  encodeCommand,
  flashEraseSector,
  flashGetId,
  flashRead4k,
  flashReadSrHigh,
  flashReadSrLow,
  flashWrite,
  flashWrite4k,
  flashWriteSr,
  linkCheck,
  readBootVersion,
  readRegister,
  readU32,
  reboot,
} from "../../../src/platforms/bk72xx/beken-packets.js";

const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(" ");
const wire = (command: BekenCommand) => hex(encodeCommand(command));

describe("encodeCommand", () => {
  // As bk7231tools' ``encode`` gives them.
  it.each([
    ["LinkCheck", linkCheck(), "01 e0 fc 01 00"],
    ["ReadReg", readRegister(0x800000), "01 e0 fc 05 03 00 00 80 00"],
    ["Reboot", reboot(), "01 e0 fc 02 0e a5"],
    ["CheckCRC", checkCrc(0x211000, 0x211fff), "01 e0 fc 09 10 00 10 21 00 ff 1f 21 00"],
    ["ReadBootVersion", readBootVersion(), "01 e0 fc 01 11"],
    ["FlashRead4K", flashRead4k(0x11000), "01 e0 fc ff f4 05 00 09 00 10 01 00"],
    ["FlashReadSR, low", flashReadSrLow(), "01 e0 fc ff f4 02 00 0c 05"],
    ["FlashReadSR, high", flashReadSrHigh(), "01 e0 fc ff f4 02 00 0c 35"],
    ["FlashWriteSR, one byte", flashWriteSr(0x1234, 1), "01 e0 fc ff f4 03 00 0d 01 34"],
    [
      "FlashWriteSR, two bytes",
      flashWriteSr(0x1234, 2),
      "01 e0 fc ff f4 04 00 0d 01 34 12",
    ],
    ["FlashGetMID", flashGetId(), "01 e0 fc ff f4 05 00 0e 9f 00 00 00"],
    ["FlashErase", flashEraseSector(0x211000), "01 e0 fc ff f4 06 00 0f 20 00 10 21 00"],
    [
      "FlashWrite",
      flashWrite(0x329f00, new Uint8Array([0xff, 0x07])),
      "01 e0 fc ff f4 07 00 06 00 9f 32 00 ff 07",
    ],
  ])("frames %s", (_name, command, bytes) => {
    expect(wire(command)).toBe(bytes);
  });

  it("frames a sector with its length in two bytes", () => {
    const frame = encodeCommand(flashWrite4k(0x211000, new Uint8Array(4096).fill(0x5a)));

    expect(hex(frame.subarray(0, 12))).toBe("01 e0 fc ff f4 05 10 07 00 10 21 00");
    expect(frame).toHaveLength(12 + 4096);
  });

  it("takes the long form for a short command whose length does not fit a byte", () => {
    const command = (size: number): BekenCommand => ({
      name: "test",
      code: 0x42,
      long: false,
      payload: new Uint8Array(size),
    });

    expect(hex(encodeCommand(command(253)).subarray(0, 5))).toBe("01 e0 fc fe 42");
    expect(hex(encodeCommand(command(254)).subarray(0, 8))).toBe(
      "01 e0 fc ff f4 ff 00 42"
    );
  });

  it("sends an address past 2 GiB as it is", () => {
    expect(wire(readRegister(0xfffffffe))).toBe("01 e0 fc 05 03 fe ff ff ff");
  });
});

describe("readU32", () => {
  it("reads little endian, from a view into a larger buffer too", () => {
    const bytes = new Uint8Array([0, 0, 0x78, 0x56, 0x34, 0xf2]).subarray(2);

    expect(readU32(bytes, 0)).toBe(0xf2345678);
  });
});
