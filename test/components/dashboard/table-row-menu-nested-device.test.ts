/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { findMenuItem, mount } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { ESPHomeTableRowMenu } from "../../../src/components/dashboard/table-row-menu.js";

async function menuFor(
  configuration: string,
  busy = false
): Promise<ESPHomeTableRowMenu> {
  return mount(new ESPHomeTableRowMenu(), {
    device: makeConfiguredDevice({ configuration }),
    position: { x: 10, y: 10 },
    busy,
  });
}

describe("table-row-menu rename / archive for nested devices", () => {
  it("offers rename and archive for a top-level device", async () => {
    const el = await menuFor("kitchen.yaml");

    expect(findMenuItem(el, "dashboard.action_rename")).toBeDefined();
    expect(findMenuItem(el, "dashboard.action_archive")).toBeDefined();
  });

  it("hides rename and archive for a device under devices/", async () => {
    const el = await menuFor("devices/lights/desk.yaml");

    expect(findMenuItem(el, "dashboard.action_rename")).toBeUndefined();
    expect(findMenuItem(el, "dashboard.action_archive")).toBeUndefined();
    expect(findMenuItem(el, "dashboard.action_clone")).toBeDefined();
    expect(findMenuItem(el, "dashboard.delete")).toBeDefined();
  });

  it.each([
    ["dashboard.action_rename", "rename-device"],
    ["dashboard.action_archive", "archive-device"],
  ])("%s emits %s for a top-level device", async (key, event) => {
    const el = await menuFor("kitchen.yaml");
    const emitted = vi.fn();
    el.addEventListener(event, emitted);

    findMenuItem(el, key)!.click();

    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["dashboard.action_rename", "rename-device"],
    ["dashboard.action_archive", "archive-device"],
  ])("%s is disabled while the device is busy", async (key, event) => {
    const el = await menuFor("kitchen.yaml", true);
    const emitted = vi.fn();
    el.addEventListener(event, emitted);
    const item = findMenuItem(el, key)!;

    item.click();

    expect(item.classList.contains("menu-item--disabled")).toBe(true);
    expect(emitted).not.toHaveBeenCalled();
  });
});
