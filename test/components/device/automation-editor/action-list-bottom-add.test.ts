/**
 * @vitest-environment happy-dom
 *
 * The action list's Add button renders below the rows — the append
 * loop never scrolls back up (#1436) — and the editor no longer
 * mounts a header-positioned add button.
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

const action = (action_id: string): ActionNode => ({ action_id, params: {} });

describe("automation-action-list add placement", () => {
  it("renders the Add button after the action rows", async () => {
    const list = new ESPHomeAutomationActionList();
    list.actions = [action("logger.log"), action("delay")];
    document.body.appendChild(list);
    await list.updateComplete;

    const add = list.shadowRoot!.querySelector<HTMLButtonElement>("button.ae-add");
    expect(add).not.toBeNull();
    const rows = [...list.shadowRoot!.querySelectorAll("esphome-automation-action-node")];
    expect(rows).toHaveLength(2);
    const lastRow = rows[rows.length - 1];
    expect(add!.compareDocumentPosition(lastRow) & Node.DOCUMENT_POSITION_PRECEDING).toBe(
      Node.DOCUMENT_POSITION_PRECEDING
    );

    list.remove();
  });
});
