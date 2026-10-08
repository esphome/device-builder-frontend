import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runBeken: vi.fn(), loadBekenImage: vi.fn() }));
vi.mock("../../../../src/platforms/bk72xx/index.js", async (importOriginal) => ({
  BEKEN_FAMILIES: (
    await importOriginal<typeof import("../../../../src/platforms/bk72xx/index.js")>()
  ).BEKEN_FAMILIES,
  runBeken: mocks.runBeken,
  loadBekenImage: mocks.loadBekenImage,
  loadBekenEngine: async () => ({}),
}));

import { BEKEN_FAMILIES } from "../../../../src/platforms/bk72xx/beken-chips.js";
import en from "../../../../src/translations/en.json";
import { BK_INSTALL } from "../../../../src/web/platforms/bk72xx/install.js";

const english = (key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>((at, part) => (at as Record<string, unknown>)?.[part], en);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("BK_INSTALL", () => {
  it("has English copy for every step", () => {
    for (const key of Object.values(BK_INSTALL.copy)) {
      expect(english(key), `missing en.json key "${key}"`).toBeTruthy();
    }
  });

  it("runs the engine as it is, with its hooks and its result", () => {
    expect(BK_INSTALL.run).toBe(mocks.runBeken);
  });

  it("offers the published image of a Beken family, picked by the chip that answers", () => {
    expect(BK_INSTALL.prebuilt!.families).toEqual(BEKEN_FAMILIES.map((f) => f.name));
    expect(BK_INSTALL.prebuilt!.runLinked).toBe(mocks.runBeken);
  });
});
