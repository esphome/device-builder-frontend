/**
 * @vitest-environment happy-dom
 *
 * Render rules + events for the shared inline manage-list used by the
 * section editor's API-action, trigger, and component-action surfaces.
 */
import { describe, expect, it } from "vitest";
import { mount } from "../../_dom.js";

import {
  ESPHomeSectionAutomationList,
  type AutomationListRow,
} from "../../../src/components/device/device-section-automation-list.js";

const ROWS: AutomationListRow[] = [
  { key: "automation:component_action:gate:open_action", label: "Open action" },
];

describe("esphome-section-automation-list", () => {
  it("renders nothing when empty and there's no add button", async () => {
    const el = await mount(new ESPHomeSectionAutomationList(), {
      rows: [],
      editLabel: "Edit",
      deleteLabel: "Delete",
    });
    expect(el.shadowRoot?.querySelector(".list")).toBeNull();
  });

  it("shows the empty placeholder when empty but addable", async () => {
    const el = await mount(new ESPHomeSectionAutomationList(), {
      rows: [],
      addLabel: "Add",
      emptyText: "Nothing yet",
      editLabel: "Edit",
      deleteLabel: "Delete",
    });
    expect(el.shadowRoot?.querySelector(".add")).not.toBeNull();
    expect(el.shadowRoot?.querySelector(".empty")?.textContent).toContain("Nothing yet");
  });

  it("omits the empty placeholder when addable but emptyText is absent", async () => {
    const el = await mount(new ESPHomeSectionAutomationList(), {
      rows: [],
      addLabel: "Add",
      editLabel: "Edit",
      deleteLabel: "Delete",
    });
    // Header + Add still render, but no blank dashed box / ARIA status.
    expect(el.shadowRoot?.querySelector(".add")).not.toBeNull();
    expect(el.shadowRoot?.querySelector(".empty")).toBeNull();
  });

  it("emits edit / delete with the row key", async () => {
    const el = await mount(new ESPHomeSectionAutomationList(), {
      rows: ROWS,
      editLabel: "Edit",
      deleteLabel: "Delete",
    });
    const events: Array<[string, string]> = [];
    el.addEventListener("edit", (e) =>
      events.push(["edit", (e as CustomEvent<{ key: string }>).detail.key])
    );
    el.addEventListener("delete", (e) =>
      events.push(["delete", (e as CustomEvent<{ key: string }>).detail.key])
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>(".row-edit")?.click();
    el.shadowRoot?.querySelector<HTMLButtonElement>(".row-delete")?.click();
    expect(events).toEqual([
      ["edit", ROWS[0].key],
      ["delete", ROWS[0].key],
    ]);
  });

  it("locks every row while busyKey is set", async () => {
    const el = await mount(new ESPHomeSectionAutomationList(), {
      rows: ROWS,
      busyKey: ROWS[0].key,
      editLabel: "Edit",
      deleteLabel: "Delete",
    });
    const buttons = el.shadowRoot?.querySelectorAll<HTMLButtonElement>(
      ".row-edit, .row-delete"
    );
    expect([...(buttons ?? [])].every((b) => b.disabled)).toBe(true);
  });
});
