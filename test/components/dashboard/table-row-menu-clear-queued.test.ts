/**
 * @vitest-environment happy-dom
 *
 * The kebab menu offers "Clear queued update" only for a device whose
 * queued_update flag is set, and the item emits clear-queued-update.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { findMenuItem, mount } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { ESPHomeTableRowMenu } from "../../../src/components/dashboard/table-row-menu.js";

function findClearItem(el: ESPHomeTableRowMenu): Element | undefined {
  return findMenuItem(el, "dashboard.action_clear_queued");
}

describe("table-row-menu clear-queued-update item", () => {
  it("emits clear-queued-update for a device with a queued update", async () => {
    const el = await mount(new ESPHomeTableRowMenu(), {
      device: makeConfiguredDevice({ runtime_state: { queued_update: true } }),
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
      device: makeConfiguredDevice({ runtime_state: { queued_update: false } }),
      position: { x: 10, y: 10 },
    });
    expect(findClearItem(el)).toBeUndefined();
  });
});

describe("table-row-menu firmware repository actions", () => {
  async function mountMenu(busy = false): Promise<ESPHomeTableRowMenu> {
    return mount(new ESPHomeTableRowMenu(), {
      device: makeConfiguredDevice(),
      position: { x: 10, y: 10 },
      busy,
    });
  }

  it("emits save and open events from the same menu used by cards and tables", async () => {
    const el = await mountMenu();
    const save = findMenuItem(el, "firmware_repository.save_action") as HTMLElement;
    const onSave = vi.fn();
    const onManage = vi.fn();
    el.addEventListener("save-firmware-repository", onSave);
    el.addEventListener("open-firmware-repository", onManage);

    save.click();
    expect(onSave).toHaveBeenCalledTimes(1);
    const manageMenu = await mountMenu();
    manageMenu.addEventListener("open-firmware-repository", onManage);
    (
      findMenuItem(manageMenu, "firmware_repository.manage_action") as HTMLElement
    ).click();
    expect(onManage).toHaveBeenCalledTimes(1);
  });

  it("disables saving while a firmware job is active", async () => {
    const el = await mountMenu(true);
    const save = findMenuItem(el, "firmware_repository.save_action") as HTMLElement;
    const onSave = vi.fn();
    el.addEventListener("save-firmware-repository", onSave);

    expect(save.classList.contains("menu-item--disabled")).toBe(true);
    save.click();
    expect(onSave).not.toHaveBeenCalled();
  });
});
