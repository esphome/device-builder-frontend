import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runAmbz: vi.fn(), loadAmbzImage: vi.fn() }));
vi.mock("../../../../src/platforms/rtl87xx/index.js", () => ({
  runAmbz: mocks.runAmbz,
  loadAmbzImage: mocks.loadAmbzImage,
  loadAmbzEngine: async () => ({}),
}));

import { english } from "../../../_en-json.js";
import { LIBRETINY_AMBZ_GUIDE_URL } from "../../../../src/common/docs.js";
import { RTL_AMBZ_INSTALL } from "../../../../src/web/platforms/rtl87xx/ambz-install.js";

describe("RTL_AMBZ_INSTALL", () => {
  it("has English copy for every step", () => {
    for (const key of Object.values(RTL_AMBZ_INSTALL.copy)) {
      expect(english(key), `missing en.json key "${key}"`).toBeTruthy();
    }
  });

  it("parses and runs with the RTL8710B's own loader and engine", () => {
    expect(RTL_AMBZ_INSTALL.load).toBe(mocks.loadAmbzImage);
    expect(RTL_AMBZ_INSTALL.run).toBe(mocks.runAmbz);
    expect(RTL_AMBZ_INSTALL.guideUrl).toBe(LIBRETINY_AMBZ_GUIDE_URL);
  });
});
