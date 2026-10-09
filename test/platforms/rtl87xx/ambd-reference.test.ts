/**
 * The engine against the reference: ``fixtures/ambd-ota1.json`` holds what
 * ltchiptool PR 98 put on the wire for a whole flash of ``fixtures/ambd.uf2``
 * against a simulated chip (``fixtures/record-ambd.py``), plus the clear of
 * the second slot the engine adds. Run against the same simulated chip, the
 * engine has to send the same bytes in the same order and leave the same
 * flash.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { merged, sha256, summarise } from "../_reference-frames.js";
import { driveFakeTimers } from "../../_fake-timers.js";

const mocks = vi.hoisted(() => ({ loadAmbdLoader: vi.fn<() => Promise<Uint8Array>>() }));
vi.mock("../../../src/platforms/rtl87xx/ambd-loader.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadAmbdLoader: mocks.loadAmbdLoader,
}));

import { flashAmbd } from "../../../src/platforms/rtl87xx/ambd-flasher.js";
import { parseAmbdImage } from "../../../src/platforms/rtl87xx/ambd-image.js";
import { fakeAmbd, fixtureAmbdUf2 } from "./_fake-ambd.js";
import reference from "./fixtures/ambd-ota1.json";

const UF2 = await fixtureAmbdUf2();
/** The recorder's stand-in loader: the transcript is about the protocol, not the file. */
const LOADER = Uint8Array.from({ length: 4688 }, (_, i) => (i * 3 + 1) % 255);

describe("flashAmbd against ltchiptool's transcript", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    mocks.loadAmbdLoader.mockResolvedValue(LOADER);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes the first slot and clears the second as the reference does", async () => {
    const chip = fakeAmbd({ ota2Valid: true, idleNaks: false });
    await driveFakeTimers(
      flashAmbd(chip.port, parseAmbdImage(UF2), { onProgress: () => {} })
    );
    const engine = await Promise.all(merged(chip.frames).map(summarise));
    expect(engine).toEqual(reference.frames);
    expect(await sha256(chip.flash)).toBe(reference.flash_sha256);
  });
});
