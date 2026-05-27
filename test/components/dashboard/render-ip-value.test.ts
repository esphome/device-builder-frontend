/**
 * Tests for the drawer's IP-value renderer.
 *
 * The renderer is the helper behind the IP Address row in the
 * device drawer's "Network" section: it stamps the IP text and,
 * when ``buildWebUiUrl`` produced a URL for the device, an
 * ``open-in-new`` icon-link to the device's web UI. The empty-IP
 * branch is the interesting one — the affordance has to render
 * even before the first resolved A-record arrives so a freshly-
 * adopted device with only a YAML mDNS hostname (``device.address``)
 * still gets a visit link.
 *
 * Vitest runs in the ``node`` environment so we don't mount Lit;
 * the existing template-walker (``test/_lit-template-walker.ts``)
 * gives us a way to assert on the produced ``TemplateResult`` —
 * presence of the anchor element, attribute bindings, and the
 * placeholder text — without a DOM.
 */
import { describe, expect, it } from "vitest";
import {
  extractAttributeBindings,
  findTemplatesByAnchor,
} from "../../_lit-template-walker.js";
import { renderIpValue } from "../../../src/components/dashboard/device-drawer-render.js";

const _identityLocalize: (key: string) => string = (key) => key;

describe("renderIpValue", () => {
  it("omits the visit link when url is empty", () => {
    const result = renderIpValue("192.168.1.42", "", _identityLocalize);
    expect(findTemplatesByAnchor(result, "<a").length).toBe(0);
    expect(findTemplatesByAnchor(result, "ip-visit-link").length).toBe(0);
    // Still emits the IP value cell.
    const valueCells = findTemplatesByAnchor(result, "value mono");
    expect(valueCells.length).toBeGreaterThan(0);
  });

  it("renders the visit-web link when url is set", () => {
    const url = "http://kitchen.local";
    const result = renderIpValue("192.168.1.42", url, _identityLocalize);
    const anchors = findTemplatesByAnchor(result, "<a");
    expect(anchors.length).toBe(1);
    const bindings = extractAttributeBindings(anchors[0]);
    expect(bindings.href).toBe(url);
    // ``rel="noopener noreferrer"`` and ``target="_blank"`` are
    // static (no Lit binding), so they don't appear in the binding
    // map — assert via the joined static template strings instead.
    const staticText = anchors[0].strings.join("§");
    expect(staticText).toContain('target="_blank"');
    expect(staticText).toContain('rel="noopener noreferrer"');
  });

  it("uses the localised visit-web label for aria-label and title", () => {
    const localize = (key: string): string =>
      key === "dashboard.action_visit_web_ui" ? "Visit web UI" : key;
    const result = renderIpValue("192.168.1.42", "http://kitchen.local", localize);
    const [anchor] = findTemplatesByAnchor(result, "<a");
    const bindings = extractAttributeBindings(anchor);
    expect(bindings["aria-label"]).toBe("Visit web UI");
    expect(bindings.title).toBe("Visit web UI");
  });

  it("renders the em-dash placeholder when ip is empty", () => {
    // No URL: render the bare placeholder cell with the muted class.
    const noUrl = renderIpValue("", "", _identityLocalize);
    const noUrlValues = noUrl.values.flat(Infinity);
    expect(noUrlValues).toContain("—");

    // With URL: still render the placeholder, plus the visit link
    // alongside it so the affordance isn't blocked on the first
    // mDNS A-record.
    const withUrl = renderIpValue("", "http://kitchen.local", _identityLocalize);
    const withUrlValues = withUrl.values.flat(Infinity);
    expect(withUrlValues).toContain("—");
    expect(findTemplatesByAnchor(withUrl, "<a").length).toBe(1);
  });

  it("applies the muted class only in the empty-IP placeholder", () => {
    // The class string is built via ``class="value mono ${expr}"``,
    // so ``muted`` lives in ``values`` (an empty string when
    // populated; ``"muted"`` when the placeholder is rendering).
    const placeholder = renderIpValue("", "", _identityLocalize);
    expect(placeholder.values).toContain("muted");

    const populated = renderIpValue("192.168.1.42", "", _identityLocalize);
    expect(populated.values).not.toContain("muted");
  });
});
