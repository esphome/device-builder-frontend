/**
 * @vitest-environment happy-dom
 *
 * Pins that an existing legacy-alias node still resolves its catalog def
 * and renders the params form — the picker filter must never reach the
 * node-level lookup.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/device/config-entry-form.js", () => ({}));
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
vi.mock("@home-assistant/webawesome/dist/components/switch/switch.js", () => ({}));

import type {
  ActionNode,
  AutomationAction,
} from "../../../../src/api/types/automations.js";
import type { ConfigEntry } from "../../../../src/api/types/config-entries.js";
import { ESPHomeAutomationActionNode } from "../../../../src/components/device/automation-editor/automation-action-node.js";

const LEGACY_DEF = {
  id: "homeassistant.service",
  name: "Homeassistant → Service",
  description: "",
  config_entries: [
    { key: "action", type: "string", label: "Action", required: false },
    { key: "service", type: "string", label: "Service", required: false, hidden: true },
  ] as unknown as ConfigEntry[],
  accepts_action_list: [],
} as unknown as AutomationAction;

describe("automation-action-node — legacy alias compatibility", () => {
  it("renders the params form for an existing homeassistant.service node", async () => {
    const el = new ESPHomeAutomationActionNode();
    el.value = { action_id: "homeassistant.service", params: {} } as ActionNode;
    el.catalog = [LEGACY_DEF];
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("esphome-config-entry-form")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".ae-row-unknown")).toBeNull();
  });
});
