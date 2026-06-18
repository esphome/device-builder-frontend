// @vitest-environment happy-dom
import type { TemplateResult } from "lit";
import { describe, expect, it } from "vitest";

import type { LocalizeFunc } from "../../../src/common/localize.js";
import { ESPHomeSettingsLanguage } from "../../../src/components/settings-dialog/language-section.js";
import { visitTemplates } from "../../_lit-template-walker.js";

const localize: LocalizeFunc = ((key: string) => key) as LocalizeFunc;

// Flatten the static strings + string values across the template tree.
// wa-select can't mount under happy-dom (form association), so inspect the
// rendered template directly instead of appending the component to the DOM.
function renderedText(root: TemplateResult): string {
  const parts: string[] = [];
  visitTemplates(root, (t) => {
    parts.push(...t.strings);
    for (const v of t.values) if (typeof v === "string") parts.push(v);
  });
  return parts.join(" ");
}

function render(): TemplateResult {
  const el = new ESPHomeSettingsLanguage();
  (el as unknown as { _localize: LocalizeFunc })._localize = localize;
  return (el as unknown as { render(): TemplateResult }).render();
}

describe("esphome-settings-language translation help", () => {
  it("renders an external link to the ESPHome translations guide", () => {
    const text = renderedText(render());
    expect(text).toContain("https://developers.esphome.io/contributing/translations/");
    expect(text).toContain('target="_blank"');
    expect(text).toContain('rel="noopener noreferrer"');
    expect(text).toContain("settings.language_help");
    expect(text).toContain("settings.language_help_link");
  });
});
