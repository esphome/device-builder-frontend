// @vitest-environment happy-dom
import { type TemplateResult, nothing } from "lit";
import { describe, expect, it } from "vitest";

import type { LanguageOption, LocalizeFunc } from "../../../src/common/localize.js";
import { ESPHomeSettingsLanguage } from "../../../src/components/settings-dialog/language-section.js";
import {
  extractAttributeBindings,
  findTemplatesByAnchor,
  visitTemplates,
} from "../../_lit-template-walker.js";

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

function renderCompleteness(option: LanguageOption): TemplateResult | typeof nothing {
  const el = new ESPHomeSettingsLanguage();
  (el as unknown as { _localize: LocalizeFunc })._localize = localize;
  return (
    el as unknown as {
      _renderCompleteness(o: LanguageOption): TemplateResult | typeof nothing;
    }
  )._renderCompleteness(option);
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

describe("esphome-settings-language completeness badge", () => {
  it("renders a translated-percentage badge in the trailing slot for an incomplete locale", () => {
    const text = renderedText(
      renderCompleteness({
        value: "de",
        flag: "🇩🇪",
        label: "Deutsch",
        completeness: 85,
      }) as TemplateResult
    );
    expect(text).toContain('slot="end"');
    expect(text).toContain("settings.language_completeness");
    expect(text).toContain("%");
  });

  it("pins an explicit per-option label that excludes the completeness badge", () => {
    // Without an explicit label, wa-select derives the collapsed display from
    // the option's text content, gluing the slot="end" badge onto the name
    // ("Deutsch99%"). Every wa-option must bind a non-empty .label whose value
    // carries the name but never the percent badge (issue #1650).
    const options = findTemplatesByAnchor(render(), "<wa-option");
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      const label = extractAttributeBindings(option)[".label"];
      expect(typeof label).toBe("string");
      expect(label as string).not.toContain("%");
      expect((label as string).length).toBeGreaterThan(0);
    }
  });

  it("omits the badge for a fully translated locale", () => {
    expect(
      renderCompleteness({
        value: "en",
        flag: "🇬🇧",
        label: "English",
        completeness: 100,
      })
    ).toBe(nothing);
  });

  it("explains what the percentage means in a note under the select", () => {
    expect(renderedText(render())).toContain("settings.language_completeness_note");
  });

  it("omits the badge when completeness is unknown (the system option)", () => {
    expect(
      renderCompleteness({
        value: "system",
        flag: "🌐",
        labelKey: "settings.language_system",
      })
    ).toBe(nothing);
  });
});
