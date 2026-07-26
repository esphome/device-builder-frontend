/**
 * @vitest-environment happy-dom
 *
 * Editing a sibling action keeps an uncatalogued passthrough node's
 * raw_body intact through the list's immutable splice (#2350).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock(
  "../../../../src/components/device/automation-editor/automation-action-node.js",
  () => ({})
);
vi.mock(
  "../../../../src/components/device/automation-editor/catalog-picker-dialog.js",
  () => ({})
);
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import type { ActionNode } from "../../../../src/api/types/automations.js";
import { ESPHomeAutomationActionList } from "../../../../src/components/device/automation-editor/automation-action-list.js";

const unknownNode: ActionNode = {
  action_id: "storage.file_append",
  params: {},
  unknown: true,
  raw_body: { path: "/data/my.log", format: "hello" },
};

describe("automation-action-list unknown passthrough round-trip (#2350)", () => {
  it("preserves an untouched unknown node when a sibling is edited", async () => {
    const list = new ESPHomeAutomationActionList();
    list.actions = [unknownNode, { action_id: "logger.log", params: { format: "a" } }];
    list.catalog = [];
    document.body.appendChild(list);
    await list.updateComplete;

    let emitted: ActionNode[] | null = null;
    list.addEventListener("actions-change", (e) => {
      emitted = (e as CustomEvent<{ actions: ActionNode[] }>).detail.actions;
    });

    // The logger row (index 1) emits an edited value, as its params form would.
    const rows = list.shadowRoot!.querySelectorAll("esphome-automation-action-node");
    rows[1].dispatchEvent(
      new CustomEvent("action-change", {
        detail: { value: { action_id: "logger.log", params: { format: "edited" } } },
        bubbles: true,
        composed: true,
      })
    );

    expect(emitted).not.toBeNull();
    // The untouched passthrough node survives verbatim, raw_body and all.
    expect(emitted![0]).toEqual(unknownNode);
    expect(emitted![1].params.format).toBe("edited");

    list.remove();
  });
});
