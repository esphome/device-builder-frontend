/**
 * @vitest-environment happy-dom
 *
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

import { identityLocalize, renderInto } from "../../../_dom.js";
import type { AutomationTree } from "../../../../src/api/types/automations.js";
import type { LocalizeFunc } from "../../../../src/common/localize.js";
import { renderActionsSection } from "../../../../src/components/device/automation-editor/render-actions-section.js";

function section() {
  return renderActionsSection({
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
}

describe("renderActionsSection", () => {
  it("wraps the root action list in the catalog picker host", () => {
    const host = renderInto(section());
    const list = host.querySelector("esphome-automation-action-list");
    expect(list!.parentElement!.localName).toBe("esphome-catalog-picker-host");
  });
});
