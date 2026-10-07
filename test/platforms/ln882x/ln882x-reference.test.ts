/**
 * The engine against the reference: ``fixtures/ln882h.json`` holds what
 * ltchiptool 4.14.4 put on the wire for a whole flash against a simulated
 * chip (``fixtures/record.py``), its write held at 115200. Run against the
 * same simulated chip, the engine has to send the same bytes in the same
 * order and leave the same flash, apart from the links ltchiptool makes
 * between steps and the ``flash_info`` the engine asks for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hex, type RecordedFrame, sha256, summarise } from "../_reference-frames.js";
import { driveFakeTimers } from "../../_fake-timers.js";
import { flashLn882x } from "../../../src/platforms/ln882x/ln882x-flasher.js";
import { UF2_FAMILY_LN882H } from "../../../src/platforms/ln882x/ln882x-image.js";
import { fakeLn882h, RAMCODE, referenceRuns } from "./_fake-ln882h.js";
import ln882h from "./fixtures/ln882h.json";

vi.mock("../../../src/platforms/ln882x/ln882x-ramcode.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadRamcode: async () => RAMCODE,
}));

const LINK = hex(new TextEncoder().encode("version\r\n"));
const FLASH_INFO = hex(new TextEncoder().encode("flash_info\r\n"));

/**
 * The frames without the exchanges that only link (``version`` and its
 * answer), of which ltchiptool makes more, nor ``flash_info``, which only
 * the engine asks: each is a sent frame and the answers up to the next.
 */
function withoutLinks(frames: RecordedFrame[]): RecordedFrame[] {
  const kept: RecordedFrame[] = [];
  let skipping = false;
  for (const frame of frames) {
    if (frame.dir === "tx") skipping = frame.hex === LINK || frame.hex === FLASH_INFO;
    if (!skipping) kept.push(frame);
  }
  return kept;
}

describe("flashLn882x against ltchiptool's transcript", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends what ltchiptool sends and leaves the same flash", async () => {
    const chip = fakeLn882h();
    const runs = referenceRuns();
    const rebooted = await driveFakeTimers(
      flashLn882x(
        chip.port,
        {
          familyId: UF2_FAMILY_LN882H,
          board: "generic-ln882h",
          runs,
          totalBytes: runs.reduce((n, r) => n + r.data.length, 0),
        },
        { onProgress: () => {} }
      )
    );
    expect(rebooted).toBe(true);
    const engine = await Promise.all(chip.frames.map(summarise));
    expect(withoutLinks(engine)).toEqual(withoutLinks(ln882h.frames));
    // The engine links where ltchiptool does, if not as often.
    expect(engine.some((f) => f.hex === LINK)).toBe(true);
    expect(await sha256(chip.flash)).toBe(ln882h.flash_sha256);
  });
});
