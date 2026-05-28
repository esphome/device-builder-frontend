/**
 * Pins the ``data-field-key`` round-trip used by the config form's
 * post-render ``<wa-select>`` value sync. The path is JSON-encoded so a
 * user-supplied map key that contains a dot (``logger.logs`` row
 * ``i2c.idf``) survives back into a path; a dotted join+split would
 * over-segment it and blank the select.
 */
import { describe, expect, it } from "vitest";
import {
  fieldKeyAttr,
  parseFieldKey,
} from "../../../src/components/device/config-entry-renderers-shared.js";

describe("fieldKeyAttr / parseFieldKey", () => {
  it("round-trips a map key that contains a dot", () => {
    expect(parseFieldKey(fieldKeyAttr(["logs", "i2c.idf"]))).toEqual(["logs", "i2c.idf"]);
  });

  it("round-trips a plain nested path", () => {
    expect(parseFieldKey(fieldKeyAttr(["api", "encryption", "key"]))).toEqual([
      "api",
      "encryption",
      "key",
    ]);
  });

  it("returns list-index segments as strings", () => {
    expect(parseFieldKey(fieldKeyAttr(["esphome", "devices", "0", "name"]))).toEqual([
      "esphome",
      "devices",
      "0",
      "name",
    ]);
  });

  it("falls back to dot-splitting for a non-JSON attribute", () => {
    expect(parseFieldKey("a.b.c")).toEqual(["a", "b", "c"]);
  });

  it("keeps a non-path UI-state key intact (pin-advanced toggle)", () => {
    expect(parseFieldKey("pin:pin-advanced")).toEqual(["pin:pin-advanced"]);
  });

  it("returns an empty path for an empty attribute", () => {
    expect(parseFieldKey("")).toEqual([]);
  });
});
