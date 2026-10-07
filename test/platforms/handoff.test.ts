import { describe, expect, it } from "vitest";
import { refusalOf } from "../../src/platforms/handoff.js";

const BYTES = new Uint8Array(4);
const REFUSAL = { key: "firmware.x_wrong_family", detail: "not ours" };

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
