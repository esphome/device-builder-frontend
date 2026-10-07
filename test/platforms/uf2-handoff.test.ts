import { describe, expect, it } from "vitest";
import type { FirmwareBinary } from "../../src/api/types/firmware-jobs.js";
import { pickUf2, refusalOf } from "../../src/platforms/uf2-handoff.js";

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
