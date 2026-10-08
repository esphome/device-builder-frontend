import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runLn882x: vi.fn(), loadLn882xImage: vi.fn() }));
vi.mock("../../../../src/platforms/ln882x/index.js", () => ({
  runLn882x: mocks.runLn882x,
  loadLn882xImage: mocks.loadLn882xImage,
  loadLn882xEngine: async () => ({}),
  warmLn882x: async () => ({}),
}));

import { english } from "../../../_en-json.js";
import { LN_INSTALL } from "../../../../src/web/platforms/ln882x/install.js";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("LN_INSTALL", () => {
  it("has English copy for every step", () => {
    for (const key of Object.values(LN_INSTALL.copy)) {
      expect(english(key), `missing en.json key "${key}"`).toBeTruthy();
    }
  });

  it("runs the engine as it is, with its hooks and its result", () => {
    expect(LN_INSTALL.run).toBe(mocks.runLn882x);
  });

  it("offers the LN882H's published image, with English copy for its choice", () => {
    expect(LN_INSTALL.prebuilt).toEqual({ families: ["LN882H"] });
    for (const key of [
      "mode_label",
      "mode_prebuilt",
      "mode_file",
      "uf2_intro",
      "prebuilt_intro",
      "prebuilt_chip_label",
      "prebuilt_download_failed",
      "prebuilt_no_image",
      "prebuilt_unknown_chip",
    ]) {
      expect(english(`web.install.${key}`), `missing en.json key "${key}"`).toBeTruthy();
    }
  });
});
