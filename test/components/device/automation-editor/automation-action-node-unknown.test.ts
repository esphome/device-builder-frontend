/**
 * @vitest-environment happy-dom
 *
 * An uncatalogued (external-component) action renders a read-only hint
 * instead of a params form, and carries its raw_body through unchanged
 * so a sibling edit round-trips it (esphome/device-builder#2350).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/device/config-entry-form.js", () => ({}));
vi.mock(
  "../../../../src/components/device/automation-editor/automation-action-list.js",
  () => ({})
);
vi.mock(
  "../../../../src/components/device/automation-editor/automation-condition-tree.js",
  () => ({})
);
vi.mock(
  "../../../../src/components/device/automation-editor/catalog-picker-dialog.js",
  () => ({})
);
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));

import type { ActionNode } from "../../../../src/api/types/automations.js";
import { ESPHomeAutomationActionNode } from "../../../../src/components/device/automation-editor/automation-action-node.js";
import { mount } from "../../../_dom.js";

const unknownNode: ActionNode = {
  action_id: "storage.file_append",
  params: {},
  unknown: true,
  raw_body: { path: "/data/my.log", format: "hello" },
};

describe("automation-action-node unknown passthrough (#2350)", () => {
  it("shows the raw action id and the read-only hint, no params form", async () => {
    const el = await mount(new ESPHomeAutomationActionNode(), {
      value: unknownNode,
      catalog: [],
    });
    expect(el.shadowRoot!.querySelector(".ae-row-picker-name")!.textContent!.trim()).toBe(
      "storage.file_append"
    );
    expect(el.shadowRoot!.querySelector(".ae-row-unknown")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("esphome-config-entry-form")).toBeNull();
  });

  it("keeps unknown + raw_body on the node value for round-trip", async () => {
    const el = await mount(new ESPHomeAutomationActionNode(), {
      value: unknownNode,
      catalog: [],
    });
    expect(el.value.unknown).toBe(true);
    expect(el.value.raw_body).toEqual({ path: "/data/my.log", format: "hello" });
  });
});
