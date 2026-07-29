import { afterEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import {
  _clearLegacySpellings,
  acceptedKeysFor,
  loadLegacySpellings,
  seedLegacySpellings,
} from "../../src/util/legacy-spellings.js";

afterEach(() => _clearLegacySpellings());

const API_PAYLOAD = {
  api: [
    { path: ["actions"], spellings: ["actions", "services"] },
    { path: ["actions", "action"], spellings: ["action", "service"] },
  ],
};

describe("legacy-spellings store", () => {
  it("resolves seeded paths and falls back to the canonical leaf", () => {
    seedLegacySpellings(API_PAYLOAD);
    expect(acceptedKeysFor("api", ["actions"])).toEqual(["actions", "services"]);
    expect(acceptedKeysFor("api", ["actions", "action"])).toEqual(["action", "service"]);
    expect(acceptedKeysFor("api", ["port"])).toEqual(["port"]);
    expect(acceptedKeysFor("wifi", ["actions"])).toEqual(["actions"]);
  });

  it("loads once per session and seeds the store", async () => {
    const getLegacySpellings = vi.fn().mockResolvedValue(API_PAYLOAD);
    const api = { getLegacySpellings } as unknown as ESPHomeAPI;
    await loadLegacySpellings(api);
    await loadLegacySpellings(api);
    expect(getLegacySpellings).toHaveBeenCalledTimes(1);
    expect(acceptedKeysFor("api", ["actions"])).toEqual(["actions", "services"]);
  });

  it("degrades to canonical-only when the fetch fails, without rejecting", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = {
      getLegacySpellings: vi.fn().mockRejectedValue(new Error("boom")),
    } as unknown as ESPHomeAPI;
    await expect(loadLegacySpellings(api)).resolves.toBeUndefined();
    expect(acceptedKeysFor("api", ["actions"])).toEqual(["actions"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
