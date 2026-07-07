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
import {
  createBackendYamlLinter,
  type BannerError,
  type MappedValidationError,
} from "../../src/util/yaml-lint-backend.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

// Echo the key + line so a humanized hit is distinguishable from raw text.
const localize = (key: string, values?: Record<string, string | number>): string =>
  values ? `${key}:${values.line}` : key;

function mountView(
  validateYaml: ESPHomeAPI["validateYaml"],
  onResult: (errors: BannerError[], mapped: MappedValidationError[]) => void
): EditorView {
  const api = { validateYaml } as unknown as ESPHomeAPI;
  return new EditorView({
    state: EditorState.create({
      // Three lines so the parse error at line 3 has an offset to map to.
      doc: "sensor:\n- platform: dht\n    model: DHT11\n",
      extensions: [
        createBackendYamlLinter({
          api,
          getConfiguration: () => "x.yaml",
          localize,
          onResult: (errors, mapped) => onResult(errors, mapped),
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
});
