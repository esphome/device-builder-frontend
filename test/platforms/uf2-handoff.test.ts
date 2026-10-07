import { describe, expect, it } from "vitest";
import type { FirmwareBinary } from "../../src/api/types/firmware-jobs.js";
import type { HandoffSpec } from "../../src/platforms/handoff.js";
import {
  NO_UF2_KEY,
  pickUf2,
  refusalOf,
  uf2Handoff,
} from "../../src/platforms/uf2-handoff.js";

const binary = (type: string, file: string) => ({ type, file }) as FirmwareBinary;
const BYTES = new Uint8Array(4);
const REFUSAL = { key: "firmware.x_wrong_family", detail: "not ours" };

describe("pickUf2", () => {
  it("picks the build's UF2", () => {
    const uf2 = binary("uf2", "firmware.uf2");
    expect(pickUf2([binary("bin", "firmware.bin"), uf2])).toBe(uf2);
  });

  it("is undefined for a build without one", () => {
    expect(pickUf2([binary("bin", "firmware.bin")])).toBeUndefined();
  });
});

describe("refusalOf", () => {
  it.each([
    ["a sync parse", () => ({ image: {} })],
    ["an async parse", async () => ({ pkg: {} })],
  ])("is null for %s that found an image", async (_label, load) => {
    expect(await refusalOf(load)(BYTES)).toBeNull();
  });

  it("returns the refusal the parse named, as is", async () => {
    expect(await refusalOf(async () => REFUSAL)(BYTES)).toBe(REFUSAL);
  });
});

describe("uf2Handoff", () => {
  const check: NonNullable<HandoffSpec["check"]> = async () => null;
  const logs: HandoffSpec["logs"] = () => "off";

  it("spells the UF2 hand-off every family shares", () => {
    const spec = uf2Handoff("bk-uart", check, logs);
    expect(spec).toMatchObject({
      flasher: "bk-uart",
      erase: false,
      noArtifactKey: NO_UF2_KEY,
    });
    expect(spec.pick).toBe(pickUf2);
    expect(spec.check).toBe(check);
    expect(spec.logs).toBe(logs);
  });

  it("leaves logs out for a family that does not know where its logs are", () => {
    expect("logs" in uf2Handoff("rtl-ambz", check)).toBe(false);
  });
});
