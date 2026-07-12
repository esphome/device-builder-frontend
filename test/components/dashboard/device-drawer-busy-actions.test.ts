/**
 * @vitest-environment happy-dom
 *
 * While a job runs, the drawer footer's Update/Install button stays
 * clickable, reads view-progress, and emits show-progress instead of
 * update-device / install-device. Edit keeps disabling.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
// Stub the drawer body; see _device-drawer.ts.
vi.mock("../../../src/components/dashboard/device-drawer-content.js", () => ({}));

import { clickCollect } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { footerAccent, mountDrawer, updateAvailableDevice } from "./_device-drawer.js";

describe("device-drawer busy footer actions", () => {
  it("busy Update stays enabled, reads view-progress, and emits show-progress", async () => {
    const el = await mountDrawer({ busy: true, device: updateAvailableDevice() });
    const btn = footerAccent(el);
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain("dashboard.table_action_view_progress");
    expect(btn.title).toBe("dashboard.table_action_view_progress");
    expect(clickCollect(el, btn, ["show-progress", "update-device"])).toEqual([
      "show-progress",
    ]);
  });

  it("idle Update emits update-device", async () => {
    const el = await mountDrawer({ busy: false, device: updateAvailableDevice() });
    const btn = footerAccent(el);
    expect(btn.textContent).toContain("dashboard.drawer_update");
    expect(clickCollect(el, btn, ["show-progress", "update-device"])).toEqual([
      "update-device",
    ]);
  });

  it("idle Install emits install-device", async () => {
    const el = await mountDrawer({
      busy: false,
      device: makeConfiguredDevice({ has_pending_changes: true }),
    });
    const btn = footerAccent(el);
    expect(btn.textContent).toContain("dashboard.install");
    expect(clickCollect(el, btn, ["show-progress", "install-device"])).toEqual([
      "install-device",
    ]);
  });

  it("busy Install stays enabled, reads view-progress, and emits show-progress", async () => {
    const el = await mountDrawer({
      busy: true,
      device: makeConfiguredDevice({ has_pending_changes: true }),
    });
    const btn = footerAccent(el);
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain("dashboard.table_action_view_progress");
    expect(btn.title).toBe("dashboard.table_action_view_progress");
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
