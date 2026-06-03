/**
 * @vitest-environment happy-dom
 *
 * Pins the component action-field surface on ``device-section-config``:
 * the unified inline delete builds the right ``component_action``
 * location from the row key, and the in-form "Edit actions" routing
 * resolves the instance id and emits the matching section key.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import type { ESPHomeAPI } from "../../../src/api/index.js";
import { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";

const GATE_YAML = `cover:
  - platform: feedback
    id: my_gate
    open_action:
      - switch.turn_on: relay_open
`;

/** Bare instance wired with yaml + sectionKey (+ resolved line). */
function makeHost(api?: Partial<ESPHomeAPI>) {
  const c = new ESPHomeDeviceSectionConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inner = c as any;
  inner.yaml = GATE_YAML;
  inner.sectionKey = "cover.feedback";
  inner._resolvedFromLine = 2;
  inner.configuration = "device.yaml";
  if (api) inner._api = api;
  return { c, inner };
}

describe("device-section-config — component action fields", () => {
  it("deletes a component_action row via the decoded location", async () => {
    const deleteAutomation = vi
      .fn()
      .mockResolvedValue({ yaml_diff: { fromLine: 4, toLine: 5, replacement: "" } });
    const updateConfig = vi.fn().mockResolvedValue(undefined);
    const { c, inner } = makeHost({
      deleteAutomation,
      updateConfig,
    } as Partial<ESPHomeAPI>);

    await inner._onDeleteRow(
      new CustomEvent("delete", {
        detail: { key: "automation:component_action:my_gate:open_action" },
      })
    );

    expect(deleteAutomation).toHaveBeenCalledWith(
      "device.yaml",
      { kind: "component_action", component_id: "my_gate", field: "open_action" },
      GATE_YAML
    );
    expect(updateConfig).toHaveBeenCalledOnce();
    expect(c).toBeDefined();
  });

  it("routes the in-form Edit-actions click to the component_action section", () => {
    const { c, inner } = makeHost();
    let selected: string | undefined;
    c.addEventListener("section-select", (e) => {
      selected = (e as CustomEvent<{ sectionKey: string }>).detail.sectionKey;
    });

    inner._onEditActionField(
      new CustomEvent("edit-action-field", { detail: { field: "open_action" } })
    );

    expect(selected).toBe("automation:component_action:my_gate:open_action");
  });
});
