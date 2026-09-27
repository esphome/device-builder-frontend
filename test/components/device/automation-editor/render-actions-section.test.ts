/**
 * @vitest-environment happy-dom
 *
 * The actions section is the one place the shared catalog picker host is
 * mounted; every add and kind button under it relies on that wrapper. It
 * also remounts the list when the editor moves on to another automation.
 */
import { render } from "lit";
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

function section(target: number) {
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
    target,
    onActionsChange: () => {},
  });
}

const list = (host: HTMLElement) => host.querySelector("esphome-automation-action-list");

describe("renderActionsSection", () => {
  it("wraps the root action list in the catalog picker host", () => {
    const host = renderInto(section(1));
    expect(list(host)!.parentElement!.localName).toBe("esphome-catalog-picker-host");
  });

  it("keeps the list across renders of the same automation", () => {
    const host = renderInto(section(1));
    const first = list(host);
    render(section(1), host);
    expect(list(host)).toBe(first);
  });

  it("remounts the list when the editor moves to another automation", () => {
    const host = renderInto(section(1));
    const first = list(host);
    render(section(2), host);
    expect(list(host)).not.toBe(first);
  });
});
