import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runLn882x: vi.fn(), loadLn882xImage: vi.fn() }));
vi.mock("../../../../src/platforms/ln882x/index.js", () => ({
  runLn882x: mocks.runLn882x,
  loadLn882xImage: mocks.loadLn882xImage,
  loadLn882xEngine: async () => ({}),
}));

import en from "../../../../src/translations/en.json";
import { LN_INSTALL } from "../../../../src/web/platforms/ln882x/install.js";

const english = (key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>((at, part) => (at as Record<string, unknown>)?.[part], en);

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
});
