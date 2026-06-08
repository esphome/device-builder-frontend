/**
 * @vitest-environment happy-dom
 *
 * The backend linter must re-validate UNCHANGED content when a
 * `relintEffect` is dispatched (e.g. after a secrets.yaml write the editor
 * doc can't see). Without the `needsRefresh` wiring the lint plugin has
 * nothing scheduled and `forceLinting` is a no-op, so the stale squiggle
 * would linger. Issue device-builder#1332.
 */
import { forceLinting } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

import type { ESPHomeAPI } from "../../src/api/esphome-api.js";
import {
  createBackendYamlLinter,
  relintEffect,
} from "../../src/util/yaml-lint-backend.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

function mountView(validateYaml: ESPHomeAPI["validateYaml"]): EditorView {
  const api = { validateYaml } as unknown as ESPHomeAPI;
  return new EditorView({
    state: EditorState.create({
      doc: "esphome:\n  name: x\n",
      extensions: [createBackendYamlLinter({ api, getConfiguration: () => "x.yaml" })],
    }),
    parent: document.body,
  });
}

describe("backend linter relint on relintEffect", () => {
  it("re-validates the same content when relintEffect is dispatched", async () => {
    const calls: string[] = [];
    const validateYaml = vi.fn(async (_cfg: string, content: string) => {
      calls.push(content);
      return { yaml_errors: [], validation_errors: [] };
    }) as unknown as ESPHomeAPI["validateYaml"];

    const view = mountView(validateYaml);
    try {
      forceLinting(view); // run the initial lint
      await flush();
      expect(calls).toHaveLength(1);

      // No doc change; the dispatched effect is what lets forceLinting re-run.
      view.dispatch({ effects: relintEffect.of(null) });
      forceLinting(view);
      await flush();

      expect(calls).toEqual(["esphome:\n  name: x\n", "esphome:\n  name: x\n"]);
    } finally {
      view.destroy();
    }
  });

  it("does not re-validate on an unrelated dispatch", async () => {
    const calls: string[] = [];
    const validateYaml = vi.fn(async (_cfg: string, content: string) => {
      calls.push(content);
      return { yaml_errors: [], validation_errors: [] };
    }) as unknown as ESPHomeAPI["validateYaml"];

    const view = mountView(validateYaml);
    try {
      forceLinting(view);
      await flush();
      expect(calls).toHaveLength(1);

      // A no-op selection dispatch must not schedule a relint.
      view.dispatch({ selection: { anchor: 0 } });
      forceLinting(view);
      await flush();

      expect(calls).toHaveLength(1);
    } finally {
      view.destroy();
    }
  });
});
