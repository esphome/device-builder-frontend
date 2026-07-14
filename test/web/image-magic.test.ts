import { describe, expect, it } from "vitest";

import { validateEspImage } from "../../src/web/flash-receiver/image-magic.js";

const withMagicAt = (offset: number, size: number) => {
  const data = new Uint8Array(size).fill(0xff);
  data[offset] = 0xe9;
  return data;
};

describe("validateEspImage", () => {
  it("accepts a native-USB image with magic at 0x0", () => {
    expect(validateEspImage([{ address: 0, data: withMagicAt(0, 64) }])).toBe(true);
  });

  it("accepts a classic ESP32 merged image with magic at 0x1000", () => {
    expect(validateEspImage([{ address: 0, data: withMagicAt(0x1000, 0x2000) }])).toBe(
      true
    );
  });

  it("accepts an ESP32-P4/C5/C61 merged image with magic at 0x2000", () => {
    expect(validateEspImage([{ address: 0, data: withMagicAt(0x2000, 0x3000) }])).toBe(
      true
    );
  });

  it("accepts a multi-part image whose bootloader is a separate part at 0x1000", () => {
    // No address-0 part; the bootloader (magic at its start) rides its own part.
    expect(
      validateEspImage([
        { address: 0x1000, data: withMagicAt(0, 64) },
        { address: 0x8000, data: new Uint8Array(64) },
      ])
    ).toBe(true);
  });

  it("accepts a multi-part image whose bootloader is a separate part at 0x2000", () => {
    expect(validateEspImage([{ address: 0x2000, data: withMagicAt(0, 64) }])).toBe(true);
  });

  it("rejects magic that lands at a non-boot offset (e.g. a part at 0x10000)", () => {
    expect(validateEspImage([{ address: 0x10000, data: withMagicAt(0, 64) }])).toBe(
      false
    );
  });

  it("rejects data without the image magic", () => {
    expect(validateEspImage([{ address: 0, data: new Uint8Array(64) }])).toBe(false);
  });
});
