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

import { EditorState } from "@codemirror/state";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
});

describe("retargetBlockDiagnostic", () => {
  const DOC = [
    "esphome:", // 0
    "  name: test", // 1
    "  friendly_name: test", // 2
    "", // 3
    "# Replace with your platform", // 4
    "esp8266:", // 5
    "  board: esp01_1m", // 6
    "", // 7
    "apccci:", // 8
    "  id: api_server", // 9
    "  encryption:", // 10
    '    key: "x"', // 11
  ].join("\n");

  /** Char offset of the first occurrence of `text` in DOC. */
  const offsetOf = (text: string) => DOC.indexOf(text);

  it("snaps a multi-line 'Component not found' child range onto the key", async () => {
    const { retargetBlockDiagnostic } =
      await import("../../src/util/yaml-lint-backend.js");
    const doc = EditorState.create({ doc: DOC }).doc;
    // esphome marks the value mapping → spans the `id:`…`key:` children.
    const fallback = { from: offsetOf("  id: api_server") + 2, to: offsetOf('"x"') + 3 };
    const { from, to } = retargetBlockDiagnostic(doc, fallback);
    expect(doc.sliceString(from, to)).toBe("apccci");
  });

  it("snaps a 'Platform missing' esphome-block range onto the esphome key", async () => {
    const { retargetBlockDiagnostic } =
      await import("../../src/util/yaml-lint-backend.js");
    const doc = EditorState.create({ doc: DOC }).doc;
    // esphome marks the esphome value mapping → spans name…the comment.
    const fallback = { from: offsetOf("  name: test") + 2, to: offsetOf("esp8266:") };
    const { from, to } = retargetBlockDiagnostic(doc, fallback);
    expect(doc.sliceString(from, to)).toBe("esphome");
  });

  it("leaves a single-line range untouched (already precise / key-marked)", async () => {
    const { retargetBlockDiagnostic } =
      await import("../../src/util/yaml-lint-backend.js");
    const doc = EditorState.create({ doc: DOC }).doc;
    const keyStart = offsetOf("apccci:");
    expect(retargetBlockDiagnostic(doc, { from: keyStart, to: keyStart + 6 })).toEqual({
      from: keyStart,
      to: keyStart + 6,
    });
  });

  it("clamps to the first line when the block has no enclosing key", async () => {
    const { retargetBlockDiagnostic } =
      await import("../../src/util/yaml-lint-backend.js");
    const doc = EditorState.create({ doc: DOC }).doc;
    // A multi-line range starting at a top-level key (no shallower line above).
    const apccciLine = doc.lineAt(offsetOf("apccci:"));
    const fallback = { from: apccciLine.from, to: offsetOf('"x"') + 3 };
    const { from, to } = retargetBlockDiagnostic(doc, fallback);
    expect(from).toBe(apccciLine.from);
    expect(to).toBe(apccciLine.to);
    expect(doc.sliceString(from, to)).toBe("apccci:");
  });

  it("passes through a range trimmed of blank-line spill as single-line content", async () => {
    const { retargetBlockDiagnostic, trimRangeToContent } =
      await import("../../src/util/yaml-lint-backend.js");
    const doc = EditorState.create({ doc: DOC }).doc;
    // esphome's end mark often lands at column 0 past a blank separator
    // (a last-list-item range); walking up to the enclosing key there
    // would attribute the error to the whole block instead of the item.
    const boardLine = doc.lineAt(offsetOf("  board: esp01_1m"));
    const raw = { from: boardLine.from + 2, to: offsetOf("apccci:") };
    const trimmed = trimRangeToContent(doc, raw);
    expect(trimmed).toEqual({ from: boardLine.from + 2, to: boardLine.to });
    expect(retargetBlockDiagnostic(doc, trimmed)).toEqual(trimmed);
  });
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
