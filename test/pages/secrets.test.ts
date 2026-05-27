// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";

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

  test("disabled while saving is in flight", () => {
    expect(
      saveDisabled(
        makePage({
          _loaded: true,
          _yaml: "wifi_password: new\n",
          _savedYaml: "wifi_password: old\n",
          _saving: true,
        })
      )
    ).toBe(true);
  });
});
