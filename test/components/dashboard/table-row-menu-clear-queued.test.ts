/**
 * @vitest-environment happy-dom
 *
 * The kebab menu offers "Clear queued update" only for a device whose
 * queued_update flag is set, and the item emits clear-queued-update.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeTableRowMenu } from "../../../src/components/dashboard/table-row-menu.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";

async function mount(queuedUpdate: boolean): Promise<ESPHomeTableRowMenu> {
  const el = new ESPHomeTableRowMenu();
  el.device = makeConfiguredDevice({ queued_update: queuedUpdate });
  el.position = { x: 10, y: 10 };
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function findClearItem(el: ESPHomeTableRowMenu): Element | undefined {
  return [...el.shadowRoot!.querySelectorAll(".menu-item")].find((item) =>
    item.textContent!.includes("dashboard.action_clear_queued")
  );
}

describe("table-row-menu clear-queued-update item", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("emits clear-queued-update for a device with a queued update", async () => {
    const el = await mount(true);
    const item = findClearItem(el);
    expect(item).toBeDefined();

    const emitted = vi.fn();
    el.addEventListener("clear-queued-update", emitted);
    (item as HTMLElement).click();
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it("hides the item when no update is queued", async () => {
    const el = await mount(false);
    expect(findClearItem(el)).toBeUndefined();
  });
});
