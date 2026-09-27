import { describe, expect, it } from "vitest";

import { makeUf2Block } from "../../_make-uf2-block.js";
import { parsePicoUf2, picoChipOf } from "../../../src/platforms/rp2/pico-uf2.js";
import { UF2_FAMILY_RP2040, UF2_FAMILY_RP2350_ARM_S } from "../../../src/util/uf2.js";

describe("parsePicoUf2", () => {
  it.each([
    ["rp2040", UF2_FAMILY_RP2040],
    ["rp2350", UF2_FAMILY_RP2350_ARM_S],
  ] as const)("takes an image for the %s and names its chip", (chip, family) => {
    const parsed = parsePicoUf2(makeUf2Block({ addr: 0x10000000, family }));
    if ("key" in parsed) throw new Error(parsed.detail);
    expect(parsed.image.totalBytes).toBe(256);
    expect(picoChipOf(parsed.image)).toBe(chip);
  });

  it.each([
    [
      "for a chip that is neither",
      makeUf2Block({ addr: 0x10000000, family: 0x12345678 }),
    ],
    ["with no family", makeUf2Block({ addr: 0x10000000, family: null })],
    ["that is no UF2", new Uint8Array(512)],
  ])("names a file %s as a bad file, and never throws", (_name, bytes) => {
    expect(parsePicoUf2(bytes)).toMatchObject({ key: "firmware.rp2_bad_uf2" });
  });
});
