// @vitest-environment happy-dom
//
// Pins the session-scoped expanded-stack persistence: shape narrowing on
// reads, round-trips, and the storage-unavailable fallbacks.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STORAGE_KEY,
  loadExpandedStack,
  saveExpandedStack,
} from "../../src/util/dashboard-stacks-session.js";

describe("dashboard-stacks-session", () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns null with nothing stored", () => {
    expect(loadExpandedStack()).toBeNull();
  });

  it("round-trips both stacks", () => {
    saveExpandedStack("remote");
    expect(loadExpandedStack()).toBe("remote");
    saveExpandedStack("builder");
    expect(loadExpandedStack()).toBe("builder");
  });

  it.each([
    ["an unknown value", "sideways"],
    ["a legacy JSON shape", '{"expanded":"remote"}'],
    ["an empty string", ""],
  ])("falls back to null on %s", (_label, raw) => {
    sessionStorage.setItem(STORAGE_KEY, raw);
    expect(loadExpandedStack()).toBeNull();
  });

  it("reads null instead of throwing when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadExpandedStack()).toBeNull();
  });

  it("drops the write instead of throwing when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveExpandedStack("remote")).not.toThrow();
  });
});
