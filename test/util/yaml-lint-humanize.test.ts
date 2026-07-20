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
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import { flush } from "../_dom.js";
import { makeComponentEntry } from "./_make-component-entry.js";
import { makeConfigEntry } from "./_make-config-entry.js";

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

/** All hover-tooltip actions across the current diagnostics. */
function collectActions(
  view: EditorView
): { name: string; apply: (v: EditorView, a: number, b: number) => void }[] {
  const actions: {
    name: string;
    apply: (v: EditorView, a: number, b: number) => void;
  }[] = [];
  forEachDiagnostic(view.state, (d) => actions.push(...(d.actions ?? [])));
  return actions;
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
          fix: { line: 2, indent: 2, key: "platform", fromIndent: 0 },
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

      const actions = collectActions(view);
      expect(actions.map((a) => a.name)).toEqual(["yaml_editor.error_auto_fix"]);

      actions[0].apply(view, 0, 0);
      expect(fixes).toEqual([{ line: 2, indent: 2, key: "platform", fromIndent: 0 }]);
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
      expect(collectActions(view)).toEqual([]);
    } finally {
      view.destroy();
    }
  });

  // A key whose only child is commented out parses as null; the inline
  // diagnostic must name the commented-out block, not just echo the bare
  // "expected a dictionary." the validator sends.
  it("squiggles the commented-out-block hint onto 'expected a dictionary.'", async () => {
    const doc = [
      "esphome:", // 1
      "  name: x", // 2
      "esp32:", // 3
      "  board: esp32dev", // 4
      "  framework:", // 5
      "    type: arduino", // 6
      "    advanced:", // 7
      '#      minimum_chip_revision: "3.1"', // 8
      "logger:", // 9
      "",
    ].join("\n");
    const validateYaml = vi.fn(async () => ({
      yaml_errors: [],
      validation_errors: [
        {
          message: "expected a dictionary.",
          range: {
            document: "x.yaml",
            start_line: 6,
            start_col: 4,
            end_line: 6,
            end_col: 12,
          },
        },
      ],
    })) as unknown as ESPHomeAPI["validateYaml"];

    const fixes: YamlAutoFix[] = [];
    const view = mountView(
      validateYaml,
      () => {},
      (fix) => fixes.push(fix),
      doc
    );
    try {
      forceLinting(view);
      await flush();
      const messages: string[] = [];
      forEachDiagnostic(view.state, (d) => messages.push(d.message));
      expect(messages).toEqual([
        "expected a dictionary. yaml_editor.error_commented_block_hint:7",
      ]);

      // The hint carries the comment-out repair as the tooltip action.
      const actions = collectActions(view);
      expect(actions.map((a) => a.name)).toEqual(["yaml_editor.error_auto_fix"]);
      actions[0].apply(view, 0, 0);
      expect(fixes).toEqual([
        { line: 7, indent: 0, key: "advanced", fromIndent: 4, kind: "comment-out" },
      ]);
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

  // The stuck dash's valid-YAML variant: `-platform:` parses as a mapping
  // key, so the error arrives from schema validation — the cause hint and
  // the dash-space repair must ride the validation banner entry.
  it("banners a stuck-dash validation error with the dash-space fix", async () => {
    const doc = ["ota:", "  -platform: esphome", ""].join("\n");
    const validateYaml = vi.fn(async () => ({
      yaml_errors: [],
      validation_errors: [
        {
          message: "'ota' requires a 'platform' key but it was not specified.",
          range: {
            document: "x.yaml",
            start_line: 1,
            start_col: 2,
            end_line: 1,
            end_col: doc.split("\n")[1].length,
          },
        },
      ],
    })) as unknown as ESPHomeAPI["validateYaml"];

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
      expect(banner[0].message).toContain("yaml_editor.error_dash_space_fix");
      expect(banner[0].fix).toEqual({
        line: 2,
        indent: 0,
        key: "-platform",
        fromIndent: 2,
        kind: "dash-space",
      });
    } finally {
      view.destroy();
    }
  });

  it("squiggles + banners the stray-top-level-key hint with the indent fix", async () => {
    const doc = "logger:\n  baud_rate: 115200\nid: mylogger\n";
    // The catalog gate needs a logger body carrying `id`; mountView's api
    // is validate-only, so this test wires the full surface itself.
    const api = {
      validateYaml: vi.fn(async () => ({
        yaml_errors: [],
        validation_errors: [
          {
            message: "Component not found: id.",
            range: {
              document: "x.yaml",
              start_line: 2,
              start_col: 0,
              end_line: 2,
              end_col: 2,
            },
          },
        ],
      })),
      getComponents: async () => ({ components: [makeComponentEntry("logger")] }),
      getComponentBodies: async () => ({
        logger: {
          ...makeComponentEntry("logger"),
          config_entries: [makeConfigEntry({ key: "id" })],
        },
      }),
    } as unknown as ESPHomeAPI;

    let banner: BannerError[] = [];
    const fixes: YamlAutoFix[] = [];
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          // The analyzer's AST agreement check needs the YAML parse tree
          // the production editor always carries.
          esphomeYaml(),
          createBackendYamlLinter({
            api,
            getConfiguration: () => "x.yaml",
            localize,
            onResult: (errors) => {
              banner = errors;
            },
            onAutoFix: (fix) => fixes.push(fix),
          }),
        ],
      }),
      parent: document.body,
    });
    try {
      forceLinting(view);
      await flush();
      const messages: string[] = [];
      forEachDiagnostic(view.state, (d) => messages.push(d.message));
      expect(messages).toEqual([
        "Component not found: id. yaml_editor.error_indent_under_section_fix:3",
      ]);

      const expectedFix = { line: 3, indent: 2, key: "id", fromIndent: 0 };
      const actions = collectActions(view);
      expect(actions.map((a) => a.name)).toEqual(["yaml_editor.error_auto_fix"]);
      actions[0].apply(view, 0, 0);
      expect(fixes).toEqual([expectedFix]);

      expect(banner).toHaveLength(1);
      expect(banner[0].fix).toEqual(expectedFix);
    } finally {
      view.destroy();
    }
  });
});
