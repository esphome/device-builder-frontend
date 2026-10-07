/**
 * The engine against the reference: ``fixtures/ambz-*.json`` hold what
 * ltchiptool 4.14.4 put on the wire for a whole flash of ``fixtures/ambz.uf2``
 * against a simulated chip (``fixtures/record.py``). Run against the same
 * simulated chip, the engine has to send the same bytes in the same order and
 * leave the same flash.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { merged, sha256, summarise } from "../_reference-frames.js";
import { driveFakeTimers } from "../../_fake-timers.js";
import { flashAmbz } from "../../../src/platforms/rtl87xx/ambz-flasher.js";
import { parseAmbzImage } from "../../../src/platforms/rtl87xx/ambz-image.js";
import { fakeAmbz, fixtureUf2 } from "./_fake-ambz.js";
import ota2 from "./fixtures/ambz-ota2.json";
import rewrite from "./fixtures/ambz-rewrite.json";

const UF2 = await fixtureUf2();

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
