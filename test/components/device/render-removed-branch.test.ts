/**
 * Pins that a section dropped with `!remove` renders the "removed" notice
 * instead of the structured form, and never the security nudge (#3093).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../../src/components/device/config-entry-form.js", () => ({}));
vi.mock("../../../src/components/device/security-notice.js", () => ({
  isSecuritySection: (k: string) => ["api", "ota.esphome", "web_server"].includes(k),
}));

import { findTemplatesByAnchor } from "../../_lit-template-walker.js";
import type { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";
import type { SectionConfigResponse } from "../../../src/components/device/device-section-config/loading.js";
import { renderStructuredFormBranch } from "../../../src/components/device/device-section-config/render-branches.js";

function render(yaml: string, sectionKey: string, fromLine: number) {
  const host = {
    yaml,
    configuration: "device.yaml",
    yamlPaneVisible: true,
    _resolvedFromLine: fromLine,
    _renderedKey: sectionKey,
    _values: {},
    _localize: (k: string) => k,
    _mergeErrors: () => ({}),
    _shortcutTarget: () => null,
    backendErrors: { fields: {} },
  } as unknown as ESPHomeDeviceSectionConfig;
  const config = {
    section_key: sectionKey,
    entries: [],
  } as unknown as SectionConfigResponse;
  return renderStructuredFormBranch(host, config, false);
}

describe("renderStructuredFormBranch — !remove", () => {
  it("renders the removed notice without the form or security nudge", () => {
    const tpl = render("wifi:\n  ssid: x\nweb_server: !remove\n", "web_server", 3);
    expect(JSON.stringify(tpl)).toContain("device.removed_section");
    expect(findTemplatesByAnchor(tpl, "<esphome-security-notice")).toHaveLength(0);
    expect(findTemplatesByAnchor(tpl, "<esphome-config-entry-form")).toHaveLength(0);
  });

  it("renders the form and nudge for a section that isn't removed", () => {
    const tpl = render("web_server:\n  port: 80\n", "web_server", 1);
    expect(JSON.stringify(tpl)).not.toContain("device.removed_section");
    expect(findTemplatesByAnchor(tpl, "<esphome-security-notice")).toHaveLength(1);
    expect(findTemplatesByAnchor(tpl, "<esphome-config-entry-form")).toHaveLength(1);
  });
});
