/**
 * @vitest-environment happy-dom
 *
 * The kebab menu offers "Clear queued update" only for a device whose
 * queued_update flag is set, and the item emits clear-queued-update.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeTableRowMenu } from "../../../src/components/dashboard/table-row-menu.js";
import { mount } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";

function findClearItem(el: ESPHomeTableRowMenu): Element | undefined {
  return [...el.shadowRoot!.querySelectorAll(".menu-item")].find((item) =>
    item.textContent!.includes("dashboard.action_clear_queued")
  );
}

describe("table-row-menu clear-queued-update item", () => {
  it("emits clear-queued-update for a device with a queued update", async () => {
    const el = await mount(new ESPHomeTableRowMenu(), {
      device: makeConfiguredDevice({ queued_update: true }),
      position: { x: 10, y: 10 },
    });
    const item = findClearItem(el);
    expect(item).toBeDefined();

    const emitted = vi.fn();
    el.addEventListener("clear-queued-update", emitted);
    (item as HTMLElement).click();
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it("hides the item when no update is queued", async () => {
    const el = await mount(new ESPHomeTableRowMenu(), {
      device: makeConfiguredDevice({ queued_update: false }),
      position: { x: 10, y: 10 },
    });
    expect(findClearItem(el)).toBeUndefined();
  });
});
