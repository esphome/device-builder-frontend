/**
 * Tests for the linter's last-result cache exposed to the save flow.
 *
 * The CodeMirror linter populates `_lastValidated` after every
 * successful backend call. The save path in ``pages/device.ts``
 * reads it via ``getLastValidatedResult`` and skips its own
 * ``validateYaml`` round-trip when the buffer matches exactly.
 *
 * Each test resets the module so the in-module map starts empty;
 * a leaked entry from a prior test would surface here as a
 * spurious cache hit and any save-flow regression that swapped
 * the buffer-equality check for something looser would surface
 * in ``returns_null_for_different_content``.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
});

describe("getLastValidatedResult", () => {
  it("returns null when nothing has been validated for the configuration", async () => {
    const { getLastValidatedResult } =
      await import("../../src/util/yaml-lint-backend.js");
    expect(getLastValidatedResult("kitchen.yaml", "esphome:\n")).toBeNull();
  });

  it("returns null for a configuration that has no entry yet", async () => {
    const { getLastValidatedResult, __setLastValidatedForTesting } =
      await import("../../src/util/yaml-lint-backend.js");
    const result = { yaml_errors: [], validation_errors: [] };
    __setLastValidatedForTesting("kitchen.yaml", "esphome:\n  name: a\n", result);
    expect(getLastValidatedResult("bedroom.yaml", "esphome:\n  name: a\n")).toBeNull();
  });

  it("returns the cached result when content matches exactly", async () => {
    const { getLastValidatedResult, __setLastValidatedForTesting } =
      await import("../../src/util/yaml-lint-backend.js");
    const result = { yaml_errors: [], validation_errors: [] };
    __setLastValidatedForTesting("kitchen.yaml", "esphome:\n  name: kitchen\n", result);
    expect(getLastValidatedResult("kitchen.yaml", "esphome:\n  name: kitchen\n")).toBe(
      result
    );
  });

  it("returns null when content differs by even one byte", async () => {
    const { getLastValidatedResult, __setLastValidatedForTesting } =
      await import("../../src/util/yaml-lint-backend.js");
    const result = { yaml_errors: [], validation_errors: [] };
    __setLastValidatedForTesting("kitchen.yaml", "esphome:\n  name: kitchen\n", result);
    expect(
      getLastValidatedResult("kitchen.yaml", "esphome:\n  name: kitchen \n")
    ).toBeNull();
  });

  it("returns null when the cached entry is past the TTL window", async () => {
    // Stub ``performance.now`` so the seed lands past the TTL boundary.
    const real = performance.now;
    let fakeNow = 1_000_000;
    vi.spyOn(performance, "now").mockImplementation(() => fakeNow);
    try {
      const { getLastValidatedResult, __setLastValidatedForTesting } =
        await import("../../src/util/yaml-lint-backend.js");
      const result = { yaml_errors: [], validation_errors: [] };
      __setLastValidatedForTesting("kitchen.yaml", "esphome:\n", result);
      fakeNow += 60_001;
      expect(getLastValidatedResult("kitchen.yaml", "esphome:\n")).toBeNull();
    } finally {
      vi.spyOn(performance, "now").mockImplementation(real);
    }
  });
});
