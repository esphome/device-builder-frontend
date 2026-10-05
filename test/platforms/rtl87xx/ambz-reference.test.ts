/**
 * The engine against the reference: ``fixtures/ambz-*.json`` hold what
 * ltchiptool 4.14.4 put on the wire for a whole flash of ``fixtures/ambz.uf2``
 * against a simulated chip (``fixtures/record.py``). Run against the same
 * simulated chip, the engine has to send the same bytes in the same order and
 * leave the same flash.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveFakeTimers } from "../../_fake-timers.js";
import { flashAmbz } from "../../../src/platforms/rtl87xx/ambz-flasher.js";
import { parseAmbzImage } from "../../../src/platforms/rtl87xx/ambz-image.js";
import { fakeAmbz, fixtureUf2, type Frame } from "./_fake-ambz.js";
import ota2 from "./fixtures/ambz-ota2.json";
import rewrite from "./fixtures/ambz-rewrite.json";

interface RecordedFrame {
  dir: string;
  length: number;
  hex?: string;
  head?: string;
  sha256?: string;
}

const UF2 = await fixtureUf2();

const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (bytes: Uint8Array) =>
  hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))));

/** Consecutive frames one way as one, as the recorder writes them down. */
function merged(frames: Frame[]): Frame[] {
  const out: Frame[] = [];
  for (const frame of frames) {
    const last = out[out.length - 1];
    if (last?.dir === frame.dir) {
      const bytes = new Uint8Array(last.bytes.length + frame.bytes.length);
      bytes.set(last.bytes);
      bytes.set(frame.bytes, last.bytes.length);
      out[out.length - 1] = { dir: frame.dir, bytes };
    } else out.push(frame);
  }
  return out;
}

/** As the recorder writes a frame down: whole up to 48 bytes, else by head and hash. */
async function summarise(frame: Frame): Promise<RecordedFrame> {
  const { bytes } = frame;
  return bytes.length <= 48
    ? { dir: frame.dir, length: bytes.length, hex: hex(bytes) }
    : {
        dir: frame.dir,
        length: bytes.length,
        head: hex(bytes.subarray(0, 16)),
        sha256: await sha256(bytes),
      };
}

describe("flashAmbz against ltchiptool's transcripts", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["the second slot, as the system data selects it", ota2],
    ["the first slot, after pointing the system data at this layout's ota2", rewrite],
  ])("writes %s", async (_, reference) => {
    const chip = fakeAmbz({
      ota2Address: parseInt(reference.chip.ota2_address, 16),
      ota2Switch: parseInt(reference.chip.ota2_switch, 16),
    });
    await driveFakeTimers(
      flashAmbz(chip.port, parseAmbzImage(UF2), { onProgress: () => {} })
    );
    const engine = await Promise.all(merged(chip.frames).map(summarise));
    expect(engine).toEqual(reference.frames);
    expect(await sha256(chip.flash)).toBe(reference.flash_sha256);
  });
});
