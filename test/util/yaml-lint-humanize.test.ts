/**
 * @vitest-environment happy-dom
 *
 * A locatable YAML parse error must reach the persistent banner (not just an
 * inline squiggle) AND carry a plain-language indentation hint plus its line,
 * so a novice who never hovers the gutter dot still gets an actionable message
 * and a jump target. Issue device-builder#1884.
 */
import { forceLinting, forEachDiagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

import type { ESPHomeAPI } from "../../src/api/esphome-api.js";
import type { YamlAutoFix } from "../../src/util/yaml-error-analysis.js";
import {
  createBackendYamlLinter,
  type BannerError,
  type MappedValidationError,
} from "../../src/util/yaml-lint-backend.js";
import { flush } from "../_dom.js";

// Echo the key + line so a humanized hit is distinguishable from raw text.
const localize = (key: string, values?: Record<string, string | number>): string =>
  values ? `${key}:${values.line}` : key;

function mountView(
  validateYaml: ESPHomeAPI["validateYaml"],
  onResult: (errors: BannerError[], mapped: MappedValidationError[]) => void,
  onAutoFix?: (fix: YamlAutoFix) => void,
  // Three lines so the parse error at line 3 has an offset to map to.
  doc = "sensor:\n- platform: dht\n    model: DHT11\n"
): EditorView {
  const api = { validateYaml } as unknown as ESPHomeAPI;
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        createBackendYamlLinter({
          api,
          getConfiguration: () => "x.yaml",
          localize,
          onResult: (errors, mapped) => onResult(errors, mapped),
          onAutoFix,
        }),
      ],
    }),
    parent: document.body,
  });
}

describe("backend linter humanizes + banners a locatable parse error", () => {
  it("pinpoints the fix in both the banner (with auto-fix) and an inline diagnostic", async () => {
    let banner: BannerError[] = [];
    const validateYaml = vi.fn(async () => ({
      yaml_errors: [
        {
          message:
            'mapping values are not allowed here\n  in "x.yaml", line 3, column 10',
        },
      ],
      validation_errors: [],
    })) as unknown as ESPHomeAPI["validateYaml"];

    const view = mountView(validateYaml, (errors) => {
      banner = errors;
    });
    try {
      forceLinting(view);
      await flush();

      // Banner: the precise indent fix, jumping to the marker (line 2), with
      // a one-click auto-fix (indent line 2 by 2 spaces). localize echoes the
      // interpolated {line}, which for the fix message is the marker line.
      expect(banner).toEqual([
        {
          message: "yaml_editor.error_indent_fix:2",
          line: 2,
          fix: { line: 2, indent: 2, key: "platform" },
          kind: "parse",
        },
      ]);

      // Inline: the same humanized message, not the raw scanner jargon.
      const messages: string[] = [];
      forEachDiagnostic(view.state, (d) => messages.push(d.message));
      expect(messages).toEqual(["yaml_editor.error_indent_fix:2"]);
    } finally {
      view.destroy();
    }
  });

  it("carries the auto-fix as a hover-tooltip action on the diagnostic", async () => {
    const validateYaml = vi.fn(async () => ({
      yaml_errors: [
        {
          message:
            'mapping values are not allowed here\n  in "x.yaml", line 3, column 10',
        },
      ],
      validation_errors: [],
    })) as unknown as ESPHomeAPI["validateYaml"];

    const fixes: YamlAutoFix[] = [];
    const view = mountView(
      validateYaml,
      () => {},
      (fix) => fixes.push(fix)
    );
    try {
      forceLinting(view);
      await flush();

      const actions: {
        name: string;
        apply: (v: EditorView, a: number, b: number) => void;
      }[] = [];
      forEachDiagnostic(view.state, (d) => actions.push(...(d.actions ?? [])));
      expect(actions.map((a) => a.name)).toEqual(["yaml_editor.error_auto_fix"]);

      actions[0].apply(view, 0, 0);
      expect(fixes).toEqual([{ line: 2, indent: 2, key: "platform" }]);
    } finally {
      view.destroy();
    }
  });

  it("omits the tooltip action when no onAutoFix handler is wired", async () => {
    const validateYaml = vi.fn(async () => ({
      yaml_errors: [
        {
          message:
            'mapping values are not allowed here\n  in "x.yaml", line 3, column 10',
        },
      ],
      validation_errors: [],
    })) as unknown as ESPHomeAPI["validateYaml"];

    const view = mountView(validateYaml, () => {});
    try {
      forceLinting(view);
      await flush();
      const actions: unknown[] = [];
      forEachDiagnostic(view.state, (d) => actions.push(...(d.actions ?? [])));
      expect(actions).toEqual([]);
    } finally {
      view.destroy();
    }
  });

  it("banners a locatable validation error with its line and nested-list hint", async () => {
    const doc = [
      "light:", // 1
      "  - platform: x", // 2
      "    effects:", // 3
      "    - addressable_twinkle:", // 4
      "      - flicker:", // 5
      "      - pulse:", // 6
      "",
    ].join("\n");
    const twinkleStart = doc.indexOf("- addressable_twinkle");
    const line4 = doc.split("\n")[3];
    const validateYaml = vi.fn(async () => ({
      yaml_errors: [],
      validation_errors: [
        {
          message: "expected a dictionary.",
          range: {
            document: "x.yaml",
            start_line: 3,
            start_col: line4.indexOf("addressable_twinkle"),
            end_line: 3,
            end_col: line4.length,
          },
        },
      ],
    })) as unknown as ESPHomeAPI["validateYaml"];
    void twinkleStart;

    let banner: BannerError[] = [];
    const view = mountView(
      validateYaml,
      (errors) => {
        banner = errors;
      },
      undefined,
      doc
    );
    try {
      forceLinting(view);
      await flush();
      expect(banner).toHaveLength(1);
      expect(banner[0].kind).toBe("validation");
      expect(banner[0].line).toBe(4);
      expect(banner[0].message).toContain("expected a dictionary.");
      expect(banner[0].message).toContain("yaml_editor.error_nested_list_hint");
    } finally {
      view.destroy();
    }
  });
});
