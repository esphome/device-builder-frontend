/**
 * Tests for ``summarizeValidation`` — reduces an upstream
 * ``EditorValidateResponse`` to the "first error" snapshot the
 * save-time validation prompt feeds into the dialog.
 *
 * The dialog drives the ``Go to error`` button's deep-link path
 * with ``first.line`` / ``first.col``; if those round-trip wrong
 * the user lands on the wrong line. Pin the four shapes the live
 * data takes:
 *
 *  - YAML parse error with ``"line N, column M"`` in the message
 *    (most common shape — ``yaml`` library's standard format);
 *  - YAML parse error with bare ``"line N"`` (no column);
 *  - YAML parse error whose message has no line at all (rare —
 *    leaves the dialog with a count + message but no jump
 *    target);
 *  - Validation error with an explicit 0-indexed range.
 */

import { describe, expect, it } from "vitest";
import type { EditorValidateResponse } from "../../src/api/types.js";
import { summarizeValidation } from "../../src/util/yaml-validation-summary.js";

function res(
  yaml_errors: EditorValidateResponse["yaml_errors"] = [],
  validation_errors: EditorValidateResponse["validation_errors"] = []
): EditorValidateResponse {
  return { yaml_errors, validation_errors };
}

describe("summarizeValidation", () => {
  it("returns count 0 when neither bucket has entries", () => {
    expect(summarizeValidation(res())).toEqual({ count: 0, first: null });
  });

  it("extracts line + column from a yaml-error message", () => {
    const summary = summarizeValidation(
      res([{ message: "mapping values not allowed at line 7, column 12" }])
    );
    expect(summary.count).toBe(1);
    expect(summary.first?.line).toBe(7);
    expect(summary.first?.col).toBe(12);
    expect(summary.first?.message).toBe(
      "mapping values not allowed at line 7, column 12"
    );
  });

  it("falls back to bare 'line N' when the column is absent", () => {
    const summary = summarizeValidation(
      res([{ message: "while parsing block mapping at line 4" }])
    );
    expect(summary.first?.line).toBe(4);
    expect(summary.first?.col).toBe(0);
  });

  it("returns line=0 when the yaml-error message has no line info", () => {
    // Backend can theoretically produce errors without positional
    // info; "Go to error" should disable rather than jump to a
    // bogus line. Dialog reads ``firstErrorLine === 0`` as
    // "no jump target".
    const summary = summarizeValidation(res([{ message: "Unknown YAML failure" }]));
    expect(summary.first?.line).toBe(0);
    expect(summary.first?.col).toBe(0);
    expect(summary.first?.message).toBe("Unknown YAML failure");
  });

  it("converts a 0-indexed validation-error range to 1-indexed line/col", () => {
    const summary = summarizeValidation(
      res(
        [],
        [
          {
            message: "Invalid value for sensor.0.platform",
            range: { start_line: 9, start_col: 4, end_line: 9, end_col: 12 },
          },
        ]
      )
    );
    expect(summary.count).toBe(1);
    expect(summary.first?.line).toBe(10);
    expect(summary.first?.col).toBe(5);
    expect(summary.first?.message).toBe("Invalid value for sensor.0.platform");
  });

  it("yaml errors win precedence over validation errors", () => {
    // Upstream's pipeline rejects parse-broken YAML before the
    // schema validator runs, but the API shape allows both —
    // pin the precedence so the dialog points at the parse
    // error (which the user MUST fix first; the validation
    // errors below it are usually downstream noise from the
    // broken parse).
    const summary = summarizeValidation(
      res(
        [{ message: "block sequence entries are not allowed at line 3, column 5" }],
        [
          {
            message: "Stale validation error",
            range: { start_line: 20, start_col: 0, end_line: 20, end_col: 1 },
          },
        ]
      )
    );
    expect(summary.count).toBe(2);
    expect(summary.first?.line).toBe(3);
    expect(summary.first?.col).toBe(5);
    expect(summary.first?.message).toBe(
      "block sequence entries are not allowed at line 3, column 5"
    );
  });

  it("counts every error across both buckets", () => {
    const summary = summarizeValidation(
      res(
        [{ message: "y1 line 1, column 1" }],
        [
          {
            message: "v1",
            range: { start_line: 0, start_col: 0, end_line: 0, end_col: 1 },
          },
          {
            message: "v2",
            range: { start_line: 1, start_col: 0, end_line: 1, end_col: 1 },
          },
        ]
      )
    );
    expect(summary.count).toBe(3);
  });
});
