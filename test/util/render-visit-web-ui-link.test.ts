/**
 * Pins the shared visit-Web-UI anchor: the target="_blank" + rel="noopener noreferrer"
 * security pair, the open-in-new glyph, the passed class/href/onClick, and
 * the icon-only (aria/title) vs withLabel (visible text, no aria) shapes.
 */
import { nothing } from "lit";
import { describe, expect, it } from "vitest";
import { renderVisitWebUiLink } from "../../src/util/visit-web-ui-link.js";
import {
  extractAttributeBindings,
  findTemplatesByAnchor,
  visitTemplates,
} from "../_lit-template-walker.js";

const _localize = (key: string) =>
  key === "dashboard.action_visit_web_ui" ? "Visit web UI" : key;

const anchorOf = (result: ReturnType<typeof renderVisitWebUiLink>) =>
  findTemplatesByAnchor(result, "<a")[0];

describe("renderVisitWebUiLink", () => {
  it("enforces the external-link security pair and open-in-new glyph", () => {
    const result = renderVisitWebUiLink("http://kitchen.local", _localize, {
      className: "x",
    });
    const anchor = anchorOf(result);
    const staticText = anchor.strings.join("§");
    expect(staticText).toContain('target="_blank"');
    expect(staticText).toContain('rel="noopener noreferrer"');
    expect(findTemplatesByAnchor(result, "open-in-new").length).toBe(1);
  });

  it("binds the passed class, href, and click handler", () => {
    const onClick = () => {};
    const result = renderVisitWebUiLink("http://kitchen.local:8080", _localize, {
      className: "menu-item menu-item--link",
      onClick,
    });
    const b = extractAttributeBindings(anchorOf(result));
    expect(b.class).toBe("menu-item menu-item--link");
    expect(b.href).toBe("http://kitchen.local:8080");
    expect(b["@click"]).toBe(onClick);
  });

  it("icon-only mode labels via aria-label and title", () => {
    const b = extractAttributeBindings(
      anchorOf(renderVisitWebUiLink("http://k.local", _localize, { className: "x" }))
    );
    expect(b["aria-label"]).toBe("Visit web UI");
    expect(b.title).toBe("Visit web UI");
  });

  it("withLabel mode drops aria/title and renders visible text", () => {
    const result = renderVisitWebUiLink("http://k.local", _localize, {
      className: "x",
      withLabel: true,
    });
    const b = extractAttributeBindings(anchorOf(result));
    expect(b["aria-label"]).toBe(nothing);
    expect(b.title).toBe(nothing);
    const allValues: unknown[] = [];
    visitTemplates(result, (t) => allValues.push(...t.values));
    expect(allValues).toContain("Visit web UI");
  });
});
