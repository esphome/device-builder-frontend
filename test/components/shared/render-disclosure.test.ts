import { html } from "lit";
import { describe, expect, it, vi } from "vitest";

// renderDisclosure's module-level registerMdiIcons() reaches webawesome's
// icon-library registry; stub it so this node-environment test stays hermetic
// and doesn't pull the DOM-dependent real implementation.
vi.mock("@home-assistant/webawesome/dist/components/icon/library.js", () => ({
  registerIconLibrary: () => {},
}));

import type { LocalizeFunc } from "../../../src/common/localize.js";
import { renderDisclosure } from "../../../src/components/shared/disclosure.js";
import { identityLocalize } from "../../_dom.js";
import {
  extractAttributeBindings,
  findTemplatesByAnchor,
  visitTemplates,
} from "../../_lit-template-walker.js";

const localize: LocalizeFunc = identityLocalize as LocalizeFunc;

const button = (result: unknown) => findTemplatesByAnchor(result, "<button")[0];

function renderedText(result: unknown): string {
  const parts: string[] = [];
  visitTemplates(result, (t) => {
    parts.push(...t.strings);
    for (const v of t.values) if (typeof v === "string") parts.push(v);
  });
  return parts.join(" ");
}

describe("renderDisclosure", () => {
  it("is collapsed when closed: no panel, body never built", () => {
    const body = vi.fn(() => html`<p>x</p>`);
    const result = renderDisclosure({
      open: false,
      onToggle: () => {},
      localize,
      labelKey: "settings.label",
      body,
    });
    expect(extractAttributeBindings(button(result))["aria-expanded"]).toBe("false");
    expect(findTemplatesByAnchor(result, 'class="disclosure-panel"')).toHaveLength(0);
    expect(body).not.toHaveBeenCalled();
  });

  it("is expanded when open: panel rendered, body built once", () => {
    const body = vi.fn(() => html`<p>x</p>`);
    const result = renderDisclosure({
      open: true,
      onToggle: () => {},
      localize,
      labelKey: "settings.label",
      panelId: "advanced-panel",
      body,
    });
    expect(extractAttributeBindings(button(result))["aria-expanded"]).toBe("true");
    expect(findTemplatesByAnchor(result, 'class="disclosure-panel"')).toHaveLength(1);
    expect(body).toHaveBeenCalledTimes(1);
  });

  it("renders the localized label and a decorative chevron", () => {
    const result = renderDisclosure({
      open: false,
      onToggle: () => {},
      localize,
      labelKey: "settings.my_label",
      body: () => html``,
    });
    expect(renderedText(result)).toContain("settings.my_label");
    const chevrons = findTemplatesByAnchor(result, "<wa-icon");
    expect(chevrons).toHaveLength(1);
    expect(chevrons[0].strings.join("")).toContain('aria-hidden="true"');
  });

  it("applies the variant class and the disabled binding", () => {
    const result = renderDisclosure({
      open: false,
      onToggle: () => {},
      localize,
      labelKey: "k",
      body: () => html``,
      variant: "quiet",
      disabled: true,
    });
    const btn = button(result);
    expect(btn.values).toContain("quiet");
    expect(extractAttributeBindings(btn)["?disabled"]).toBe(true);
  });

  it("places the chevron before the label when iconBefore is set", () => {
    const order: string[] = [];
    const result = renderDisclosure({
      open: false,
      onToggle: () => {},
      localize,
      labelKey: "k",
      body: () => html``,
      iconBefore: true,
    });
    visitTemplates(result, (t) => {
      const s = t.strings.join("");
      if (s.includes("<wa-icon")) order.push("icon");
      else if (s.includes("disclosure-toggle__label")) order.push("label");
    });
    expect(order).toEqual(["icon", "label"]);
  });
});
