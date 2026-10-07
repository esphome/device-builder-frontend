import { describe, expect, it } from "vitest";
import type { FirmwareBinary } from "../../src/api/types/firmware-jobs.js";
import { pickUf2 } from "../../src/platforms/uf2-handoff.js";

const binary = (type: string, file: string) => ({ type, file }) as FirmwareBinary;

describe("pickUf2", () => {
  it("picks the build's UF2", () => {
    const uf2 = binary("uf2", "firmware.uf2");
    expect(pickUf2([binary("bin", "firmware.bin"), uf2])).toBe(uf2);
  });

  it("is undefined for a build without one", () => {
    expect(pickUf2([binary("bin", "firmware.bin")])).toBeUndefined();
  });
});
