/**
 * @vitest-environment happy-dom
 *
 * While a job runs, the drawer footer's Update/Install button stays
 * clickable, reads view-progress, and emits show-progress instead of
 * update-device / install-device. Edit keeps disabling.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
// The drawer body renders children that pull in <wa-button> (form-associated,
// noisy under happy-dom); the footer under test uses plain buttons, so stubbing
// the body keeps the mount light and quiet.
vi.mock("../../../src/components/dashboard/device-drawer-content.js", () => ({}));

import { ESPHomeDeviceDrawer } from "../../../src/components/dashboard/device-drawer.js";
import { mount } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";

function accent(el: ESPHomeDeviceDrawer): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(".footer .action--accent")!;
}

function clickCollect(
  el: ESPHomeDeviceDrawer,
  btn: HTMLElement,
  events: string[]
): string[] {
  const fired: string[] = [];
  for (const name of events) {
    el.addEventListener(name, () => fired.push(name));
  }
  btn.click();
  return fired;
}

describe("device-drawer busy footer actions", () => {
  it("busy Update stays enabled, reads view-progress, and emits show-progress", async () => {
    const el = await mount(new ESPHomeDeviceDrawer(), {
      open: true,
      busy: true,
      device: makeConfiguredDevice({
        update_available: true,
        runtime_state: { deployed_version: "2024.6.0" },
        current_version: "2024.12.0",
      }),
    });
    const btn = accent(el);
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain("dashboard.table_action_view_progress");
    expect(btn.title).toBe("dashboard.table_action_view_progress");
    expect(clickCollect(el, btn, ["show-progress", "update-device"])).toEqual([
      "show-progress",
    ]);
  });

  it("idle Update emits update-device", async () => {
    const el = await mount(new ESPHomeDeviceDrawer(), {
      open: true,
      busy: false,
      device: makeConfiguredDevice({
        update_available: true,
        runtime_state: { deployed_version: "2024.6.0" },
        current_version: "2024.12.0",
      }),
    });
    const btn = accent(el);
    expect(btn.textContent).toContain("dashboard.drawer_update");
    expect(clickCollect(el, btn, ["show-progress", "update-device"])).toEqual([
      "update-device",
    ]);
  });

  it("busy Install stays enabled, reads view-progress, and emits show-progress", async () => {
    const el = await mount(new ESPHomeDeviceDrawer(), {
      open: true,
      busy: true,
      device: makeConfiguredDevice({ has_pending_changes: true }),
    });
    const btn = accent(el);
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain("dashboard.table_action_view_progress");
    expect(clickCollect(el, btn, ["show-progress", "install-device"])).toEqual([
      "show-progress",
    ]);
    // Edit keeps disabling: editing mid-job stays gated.
    expect(
      el.shadowRoot!.querySelector<HTMLButtonElement>(".footer .action--primary")!
        .disabled
    ).toBe(true);
  });
});
