/**
 * The engine against the reference: ``fixtures/*.json`` hold what
 * bk7231tools 2.1.2 put on the wire for a whole flash, driven as ltchiptool
 * drives it, against a simulated chip (``fixtures/record.py``). Run against
 * the same simulated chip, the engine has to send the same bytes in the
 * same order and leave the same flash.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveFakeTimers } from "../../_fake-timers.js";
import { flashBeken } from "../../../src/platforms/bk72xx/beken-flasher.js";
import { type ChipSpec, fakeBeken, type Frame, referenceImage } from "./_fake-beken.js";
import basicUnknown from "./fixtures/basic-unknown-bootloader.json";
import bk7231nUnknown from "./fixtures/bk7231n-unknown-bootloader.json";
import bk7231n from "./fixtures/bk7231n.json";
import bk7231t from "./fixtures/bk7231t.json";
import bk7238 from "./fixtures/bk7238.json";
import bk7252 from "./fixtures/bk7252.json";

interface RecordedFrame {
  dir: string;
  length: number;
  hex?: string;
  head?: string;
  sha256?: string;
}

interface Transcript {
  name: string;
  chip: object;
  flash_sha256: string;
  frames: RecordedFrame[];
}

const transcripts: Transcript[] = [
  bk7231n,
  bk7238,
  bk7231t,
  bk7252,
  bk7231nUnknown,
  basicUnknown,
];

const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
  hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));

/** A frame as the recorder writes it down. */
const summarise = async ({ dir, bytes }: Frame): Promise<RecordedFrame> =>
  bytes.length <= 48
    ? { dir, length: bytes.length, hex: hex(bytes) }
    : {
        dir,
        length: bytes.length,
        head: hex(bytes.subarray(0, 16)),
        sha256: await sha256(new Uint8Array(bytes)),
      };

// The image is the same for every chip; the family is not looked at by a
// chip whose family is another, which the mismatch has tests of its own for.
const FAMILY_BY_CHIP: Record<string, number> = {
  bk7231n: 0x7b3ef230,
  bk7238: 0x159ac324,
  bk7231t: 0x675a40b0,
  bk7252: 0x6a82cc42,
  "bk7231n-unknown-bootloader": 0x7b3ef230,
  "basic-unknown-bootloader": 0x675a40b0,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the engine puts on the wire what bk7231tools does", () => {
  it("has a transcript for every chip and for a bootloader that is not known", () => {
    expect(transcripts.map((t) => t.name).sort()).toEqual(
      Object.keys(FAMILY_BY_CHIP).sort()
    );
  });

  it.each(transcripts)("$name", async (recorded) => {
    const chip = fakeBeken(recorded.chip as ChipSpec);

    await driveFakeTimers(
      flashBeken(chip.port, referenceImage(FAMILY_BY_CHIP[recorded.name]), {
        onProgress: () => {},
      })
    );

    vi.useRealTimers();
    expect(await Promise.all(chip.frames.map(summarise))).toEqual(recorded.frames);
    expect(await sha256(chip.flash)).toBe(recorded.flash_sha256);
  });
});
