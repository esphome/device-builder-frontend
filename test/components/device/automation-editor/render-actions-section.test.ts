/**
 * The actions section is the one place the shared catalog picker host is
 * mounted; every add and kind button under it relies on that wrapper.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock(
  "../../../../src/components/device/automation-editor/automation-action-list.js",
  () => ({})
);
vi.mock(
  "../../../../src/components/device/automation-editor/catalog-picker-host.js",
  () => ({})
);

import { identityLocalize } from "../../../_dom.js";
import { findTemplatesByAnchor } from "../../../_lit-template-walker.js";
import type { AutomationTree } from "../../../../src/api/types/automations.js";
import type { LocalizeFunc } from "../../../../src/common/localize.js";
import { renderActionsSection } from "../../../../src/components/device/automation-editor/render-actions-section.js";

describe("renderActionsSection", () => {
  it("wraps the root action list in the catalog picker host", () => {
    const result = renderActionsSection({
      automation: { actions: [] } as unknown as AutomationTree,
      catalog: [],
      conditionCatalog: [],
      scripts: [],
      devices: [],
      board: null,
      yaml: "",
      disabled: false,
      localize: identityLocalize as LocalizeFunc,
      descriptionKey: "device.automation_action_description",
      onActionsChange: () => {},
    });
    const [section] = findTemplatesByAnchor(result, "<esphome-catalog-picker-host");
    const markup = section.strings.join("");
    expect(markup.indexOf("<esphome-catalog-picker-host")).toBeLessThan(
      markup.indexOf("<esphome-automation-action-list")
    );
    expect(markup.indexOf("</esphome-automation-action-list>")).toBeLessThan(
      markup.indexOf("</esphome-catalog-picker-host>")
    );
  });
});
