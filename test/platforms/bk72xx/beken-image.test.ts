import { describe, expect, it } from "vitest";
import {
  ltHeaderTags,
  ltPartInfoTags,
  ltPartitionTable,
  makeLibreTinyUf2,
} from "../../_make-libretiny-uf2.js";
import { BEKEN_FAMILIES, familyOf } from "../../../src/platforms/bk72xx/beken-chips.js";
import {
  BekenImageError,
  parseBekenImage,
} from "../../../src/platforms/bk72xx/beken-image.js";

const file = (family: number, addr = 0) =>
  makeLibreTinyUf2({
    family,
    headerTags: ltHeaderTags({
      BOARD: "cb3s",
      FAL_PTABLE: ltPartitionTable([
        { name: "app", offset: 0x11000, length: 0x119000 },
        { name: "download", offset: 0x12a000, length: 0xa6000 },
      ]),
    }),
    blocks: [
      { addr, fill: 0x5a, tags: ltPartInfoTags([0, 1, 0, 1, 0, 0], ["app"]) },
      { addr: 0, fill: 0x6b, tags: ltPartInfoTags([1, 0, 0, 0, 0, 0], ["download"]) },
    ],
  });

describe("parseBekenImage", () => {
  it.each(BEKEN_FAMILIES.map((f) => [f.name, f.id] as const))(
    "takes the app of a %s build, not what is for the device's own update",
    (_name, id) => {
      const image = parseBekenImage(file(id));

      expect(image.familyId).toBe(id);
      expect(image.board).toBe("cb3s");
      expect(image.runs.map((r) => r.address)).toEqual([0x11000]);
    }
  );

  it("takes a run inside the last sector of the app partition", () => {
    const image = parseBekenImage(file(0x7b3ef230, 0x119000 - 0x100));

    expect(image.runs[0].address).toBe(0x129f00);
  });

  it("names a build for a chip that is not Beken's", () => {
    const parse = () => parseBekenImage(file(0xe08f7564));

    expect(parse).toThrow(BekenImageError);
    expect(parse).toThrow(expect.objectContaining({ key: "firmware.bk_wrong_family" }));
  });

  it("names a file that is not a LibreTiny UF2", () => {
    expect(() => parseBekenImage(new Uint8Array(512))).toThrow(
      expect.objectContaining({ key: "firmware.bk_bad_uf2" })
    );
  });

  it("carries a cause that is not an error as its message", () => {
    expect(new BekenImageError("firmware.bk_bad_uf2", "odd").message).toBe("odd");
  });
});

describe("familyOf", () => {
  it("knows the Beken families and no other", () => {
    expect(familyOf(0x159ac324)?.name).toBe("BK7238");
    expect(familyOf(0xe08f7564)).toBeUndefined();
  });
});
