/**
 * @vitest-environment happy-dom
 *
 * While a job runs, the menu's Install item stays clickable, reads
 * view-progress, and emits show-progress instead of install-device.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeTableRowMenu } from "../../../src/components/dashboard/table-row-menu.js";
import { clickCollect, mount } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";

function installItem(el: ESPHomeTableRowMenu): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>(".menu-item--install")!;
}

describe("table-row-menu install item while busy", () => {
  it("stays enabled, reads view-progress, and emits show-progress for its device", async () => {
    const device = makeConfiguredDevice({});
    const el = await mount(new ESPHomeTableRowMenu(), {
      device,
      position: { x: 10, y: 10 },
      busy: true,
    });
    const item = installItem(el);
    expect(item.classList.contains("menu-item--disabled")).toBe(false);
    expect(item.textContent).toContain("dashboard.table_action_view_progress");

    // With several jobs running, the detail is what routes the click to
    // THIS device's job.
    const detail = vi.fn();
    el.addEventListener("show-progress", (e) => detail((e as CustomEvent).detail));
    expect(clickCollect(el, item, ["show-progress", "install-device"])).toEqual([
      "show-progress",
    ]);
    expect(detail).toHaveBeenCalledWith(device);
  });

  it("emits install-device when idle", async () => {
    const el = await mount(new ESPHomeTableRowMenu(), {
      device: makeConfiguredDevice({}),
      position: { x: 10, y: 10 },
      busy: false,
    });
    const item = installItem(el);
    expect(item.textContent).toContain("dashboard.action_install");
    expect(clickCollect(el, item, ["show-progress", "install-device"])).toEqual([
      "install-device",
    ]);
  });
});
