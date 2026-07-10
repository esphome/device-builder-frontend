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
import type { EditorValidateResponse } from "../../src/api/types/editor.js";
import {
  basename,
  isOpenConfigFile,
  summarizeValidation,
} from "../../src/util/yaml-validation-summary.js";

function res(
  yaml_errors: EditorValidateResponse["yaml_errors"] = [],
  validation_errors: EditorValidateResponse["validation_errors"] = []
): EditorValidateResponse {
  return { yaml_errors, validation_errors };
}

// Echo the key + interpolated values so a humanized hit is distinguishable.
const localize = (key: string, values?: Record<string, string | number>): string =>
  values ? `${key}:${JSON.stringify(values)}` : key;

/** Summarize against an (optionally empty) buffer with the echo localizer. */
const summarize = (r: EditorValidateResponse, content = "") =>
  summarizeValidation(r, content, localize);

describe("summarizeValidation", () => {
  it("returns count 0 when neither bucket has entries", () => {
    expect(summarize(res())).toEqual({ count: 0, first: null });
  });

  it("extracts line + column from a yaml-error message", () => {
    const summary = summarize(
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
    const summary = summarize(
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
    const summary = summarize(res([{ message: "Unknown YAML failure" }]));
    expect(summary.first?.line).toBe(0);
    expect(summary.first?.col).toBe(0);
    expect(summary.first?.message).toBe("Unknown YAML failure");
  });

  it("converts a 0-indexed validation-error range to 1-indexed line/col", () => {
    const summary = summarize(
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
    const summary = summarize(
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

  it("carries the validation-error source document as first.file", () => {
    const summary = summarize(
      res(
        [],
        [
          {
            message: "'foo' is an invalid option for [sensor]",
            range: {
              document: "/config/esphome/common/base.yaml",
              start_line: 41,
              start_col: 2,
              end_line: 41,
              end_col: 5,
            },
          },
        ]
      )
    );
    expect(summary.first?.file).toBe("/config/esphome/common/base.yaml");
  });

  it("leaves first.file null when the validator reports no document", () => {
    const summary = summarize(
      res(
        [],
        [
          {
            message: "Invalid value",
            range: { start_line: 1, start_col: 0, end_line: 1, end_col: 1 },
          },
        ]
      )
    );
    expect(summary.first?.file).toBeNull();
  });

  it("leaves first.file null for yaml parse errors", () => {
    const summary = summarize(res([{ message: "boom at line 3, column 1" }]));
    expect(summary.first?.file).toBeNull();
  });

  it("jumps to the problem mark, humanized, never the context mark (line 3 bug)", () => {
    // A dedented list marker deep in the file: PyYAML's context mark points
    // at the enclosing block's start (line 1), the problem mark at the
    // marker itself (line 5). The dialog must land on 5 with the same
    // indent-fix wording as the banner, with the absolute path collapsed.
    const content = [
      "sensor:", // 1
      "  # Uptime sensor.", // 2
      "  - platform: uptime", // 3
      "    name: Ethernet Uptime", // 4
      "- platform: template", // 5
      "    name: Free Memory", // 6
    ].join("\n");
    const message =
      "while parsing a block mapping\n" +
      '  in "/Users/bdraco/esphome/smallgarage.yaml", line 1, column 1\n' +
      "expected <block end>, but found '-'\n" +
      '  in "/Users/bdraco/esphome/smallgarage.yaml", line 5, column 1';
    const summary = summarize(res([{ message }]), content);
    expect(summary.first?.line).toBe(5);
    expect(summary.first?.message).toContain("yaml_editor.error_indent_fix:");
    expect(summary.first?.message).toContain('"line":5');
    expect(summary.first?.message).not.toContain("/Users/bdraco");
  });

  it("drops the column when the jump retargets off the problem mark", () => {
    // The over-indented-property shape: the scanner blames the property
    // (line 3 col 10), the fix site is the marker (line 2) — the original
    // column is meaningless against the retargeted line.
    const content = "sensor:\n- platform: dht\n    model: DHT11\n";
    const message =
      'mapping values are not allowed here\n  in "x.yaml", line 3, column 10';
    const summary = summarize(res([{ message }]), content);
    expect(summary.first?.line).toBe(2);
    expect(summary.first?.col).toBe(0);
    expect(summary.first?.message).toContain("yaml_editor.error_indent_fix:");
  });

  it("collapses absolute paths in an unhumanized fallback message", () => {
    const summary = summarize(
      res([{ message: 'found a tab in "/Users/me/esphome/foo.yaml", line 2, column 3' }])
    );
    expect(summary.first?.message).toContain('"foo.yaml"');
    expect(summary.first?.message).not.toContain("/Users/me");
  });

  it("adds the value-type cause hint for an open-buffer validation error", () => {
    const content = "logger:\n  le\n";
    const summary = summarize(
      res(
        [],
        [
          {
            message: "expected a dictionary.",
            range: { start_line: 1, start_col: 2, end_line: 1, end_col: 4 },
          },
        ]
      ),
      content
    );
    expect(summary.first?.message).toContain("expected a dictionary.");
    expect(summary.first?.message).toContain("yaml_editor.error_missing_colon_hint");
  });

  it("skips the cause hint when the error lives in an included file", () => {
    const content = "logger:\n  le\n";
    const summary = summarize(
      res(
        [],
        [
          {
            message: "expected a dictionary.",
            range: {
              document: "/config/esphome/common/base.yaml",
              start_line: 1,
              start_col: 2,
              end_line: 1,
              end_col: 4,
            },
          },
        ]
      ),
      content
    );
    expect(summary.first?.message).toBe("expected a dictionary.");
  });

  it("disables navigation for a validation error without a range", () => {
    // The linter path already treats a null range as unplaceable; the
    // dialog reads line 0 as "no jump target" rather than jumping to 1:1.
    const summary = summarize(
      res([], [{ message: "Component not found: foo", range: null }])
    );
    expect(summary.first?.line).toBe(0);
    expect(summary.first?.col).toBe(0);
    expect(summary.first?.message).toBe("Component not found: foo");
  });

  it("counts every error across both buckets", () => {
    const summary = summarize(
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

describe("basename", () => {
  it("returns the last segment of a posix path", () => {
    expect(basename("/config/esphome/common/base.yaml")).toBe("base.yaml");
  });

  it("returns the last segment of a windows path", () => {
    expect(basename("C:\\config\\esphome\\base.yaml")).toBe("base.yaml");
  });

  it("returns the input when there is no separator", () => {
    expect(basename("base.yaml")).toBe("base.yaml");
  });
});

describe("isOpenConfigFile", () => {
  it("treats the --ace main-file sentinel as the open config", () => {
    // The `esphome vscode --ace` loader leaves the main stream unnamed,
    // so main-file errors report "<file>"; only includes carry a real path.
    expect(isOpenConfigFile("<file>", "light.yaml")).toBe(true);
  });

  it("treats a missing document as the open config", () => {
    expect(isOpenConfigFile("", "light.yaml")).toBe(true);
  });

  it("matches an exact document path", () => {
    expect(isOpenConfigFile("light.yaml", "light.yaml")).toBe(true);
  });

  it("matches an exact document path after normalizing separators", () => {
    expect(isOpenConfigFile("sub\\light.yaml", "sub/light.yaml")).toBe(true);
  });

  it("treats an included file as not the open config", () => {
    expect(isOpenConfigFile("/config/esphome/common/base.yaml", "light.yaml")).toBe(
      false
    );
  });

  it("does not match an included file that merely shares the open file's name", () => {
    // open light.yaml, error in packages/light.yaml — same basename,
    // different file; a suffix match would navigate the wrong document.
    expect(isOpenConfigFile("/config/esphome/packages/light.yaml", "light.yaml")).toBe(
      false
    );
  });
});
