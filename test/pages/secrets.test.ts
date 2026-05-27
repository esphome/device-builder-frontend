// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";

import type { ESPHomeAPI } from "../../src/api/index.js";
import { ESPHomePageSecrets } from "../../src/pages/secrets.js";
import {
  extractAttributeBindings,
  findTemplatesByAnchor,
} from "../_lit-template-walker.js";

/**
 * Pin the secrets-page data-loss guards: don't render an editor
 * with empty content while loading, and keep Save disabled when
 * the buffer is empty.
 */

interface PageView {
  _loaded: boolean;
  _yaml: string;
  _savedYaml: string;
  _saving: boolean;
  _api: ESPHomeAPI;
  _save(): Promise<void>;
  render(): unknown;
}

function makePage(overrides: Partial<PageView> = {}): PageView {
  const page = new ESPHomePageSecrets() as unknown as PageView;
  page._loaded = false;
  page._yaml = "";
  page._savedYaml = "";
  page._saving = false;
  Object.assign(page, overrides);
  return page;
}

describe("esphome-page-secrets editor gating", () => {
  test("while loading: spinner is rendered, no editor, no save button", () => {
    const tree = makePage({ _loaded: false }).render();
    expect(findTemplatesByAnchor(tree, "<wa-spinner")).toHaveLength(1);
    expect(findTemplatesByAnchor(tree, "<esphome-yaml-editor")).toHaveLength(0);
    expect(findTemplatesByAnchor(tree, 'class="save-button"')).toHaveLength(0);
  });

  test("after load: editor is rendered with the loaded buffer, spinner gone", () => {
    const tree = makePage({
      _loaded: true,
      _yaml: "wifi_password: hunter2\n",
      _savedYaml: "wifi_password: hunter2\n",
    }).render();
    expect(findTemplatesByAnchor(tree, "<wa-spinner")).toHaveLength(0);
    const editors = findTemplatesByAnchor(tree, "<esphome-yaml-editor");
    expect(editors).toHaveLength(1);
    expect(extractAttributeBindings(editors[0])[".value"]).toBe(
      "wifi_password: hunter2\n"
    );
  });
});

describe("esphome-page-secrets save-button disabled state", () => {
  function saveDisabled(page: PageView): unknown {
    const buttons = findTemplatesByAnchor(page.render(), 'class="save-button"');
    expect(buttons).toHaveLength(1);
    return extractAttributeBindings(buttons[0])["?disabled"];
  }

  test("disabled when buffer equals saved (no dirty state)", () => {
    const yaml = "wifi_password: hunter2\n";
    expect(saveDisabled(makePage({ _loaded: true, _yaml: yaml, _savedYaml: yaml }))).toBe(
      true
    );
  });

  test("enabled when buffer differs from saved AND is non-empty", () => {
    expect(
      saveDisabled(
        makePage({
          _loaded: true,
          _yaml: "wifi_password: new\n",
          _savedYaml: "wifi_password: old\n",
        })
      )
    ).toBe(false);
  });

  test("disabled when buffer is empty even though it differs from saved", () => {
    expect(
      saveDisabled(
        makePage({
          _loaded: true,
          _yaml: "",
          _savedYaml: "wifi_password: hunter2\n",
        })
      )
    ).toBe(true);
  });

  test("disabled when buffer is whitespace-only even though it differs from saved", () => {
    expect(
      saveDisabled(
        makePage({
          _loaded: true,
          _yaml: "   \n\t\n",
          _savedYaml: "wifi_password: hunter2\n",
        })
      )
    ).toBe(true);
  });

  test("_save() flips _saving true during the in-flight call and false after", async () => {
    let resolveUpdate!: () => void;
    const updateConfigPromise = new Promise<void>((r) => {
      resolveUpdate = r;
    });
    const page = makePage({
      _loaded: true,
      _yaml: "wifi_password: new\n",
      _savedYaml: "wifi_password: old\n",
    });
    page._api = {
      updateConfig: vi.fn().mockReturnValue(updateConfigPromise),
    } as unknown as ESPHomeAPI;

    expect(page._saving).toBe(false);
    const savePromise = page._save();
    // In-flight: _saving is true and the rendered button reflects that.
    expect(page._saving).toBe(true);
    expect(saveDisabled(page)).toBe(true);

    resolveUpdate();
    await savePromise;

    expect(page._saving).toBe(false);
    // Post-success: dirty-check disables (yaml === savedYaml now).
    expect(saveDisabled(page)).toBe(true);
  });
});
