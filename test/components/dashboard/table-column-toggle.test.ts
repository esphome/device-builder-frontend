/**
 * @vitest-environment happy-dom
 *
 * Pins keyboard operability of the column-toggle menu: the
 * role="menuitemcheckbox" rows are <div>s (not <button>s), so they
 * need tabindex + an Enter/Space keydown handler to be reachable by
 * keyboard-only users. Mouse clicks already worked; these tests cover
 * the keyboard path that was previously dead.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import "../../../src/components/dashboard/table-column-toggle.js";
import type {
  ESPHomeTableColumnToggle,
  ToggleableColumn,
} from "../../../src/components/dashboard/table-column-toggle.js";

const COLUMNS: ToggleableColumn[] = [
  { id: "ip", header: "IP", visible: true },
  { id: "mac", header: "MAC", visible: false },
];

async function mount(): Promise<ESPHomeTableColumnToggle> {
  const el = document.createElement(
    "esphome-table-column-toggle"
  ) as ESPHomeTableColumnToggle;
  el.columns = COLUMNS;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

async function openMenu(el: ESPHomeTableColumnToggle): Promise<HTMLElement[]> {
  el.shadowRoot!.querySelector<HTMLButtonElement>(".toggle-btn")!.click();
  await el.updateComplete;
  return Array.from(
    el.shadowRoot!.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')
  );
}

describe("esphome-table-column-toggle keyboard operability", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("makes each menu item focusable via tabindex", async () => {
    const el = await mount();
    const items = await openMenu(el);
    expect(items).toHaveLength(COLUMNS.length);
    for (const item of items) {
      expect(item.getAttribute("tabindex")).toBe("0");
    }
  });

  it("fires column-visibility-change on Enter", async () => {
    const el = await mount();
    const events: Array<{ id: string; visible: boolean }> = [];
    el.addEventListener("column-visibility-change", (e) =>
      events.push((e as CustomEvent).detail)
    );

    const [first] = await openMenu(el);
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    // First column starts visible; Enter toggles it off.
    expect(events).toEqual([{ id: "ip", visible: false }]);
  });

  it("fires column-visibility-change on Space", async () => {
    const el = await mount();
    const events: Array<{ id: string; visible: boolean }> = [];
    el.addEventListener("column-visibility-change", (e) =>
      events.push((e as CustomEvent).detail)
    );

    const items = await openMenu(el);
    items[1].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

    // Second column starts hidden; Space toggles it on.
    expect(events).toEqual([{ id: "mac", visible: true }]);
  });

  it("ignores other keys", async () => {
    const el = await mount();
    const events: unknown[] = [];
    el.addEventListener("column-visibility-change", (e) => events.push(e));

    const [first] = await openMenu(el);
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));

    expect(events).toHaveLength(0);
  });
});
