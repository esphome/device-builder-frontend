/**
 * @vitest-environment happy-dom
 *
 * Pins the drawer header's untracked branch: a flagged non-online
 * device reads "No status" with the unknown treatment instead of
 * Device Offline.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));
// Stub the drawer body; see _device-drawer.ts.
vi.mock("../../../src/components/dashboard/device-drawer-content.js", () => ({}));

import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { DeviceState } from "../../../src/api/types/devices.js";
import { mountDrawer } from "./_device-drawer.js";

describe("device-drawer untracked header", () => {
  it("shows No status with the unknown treatment for a flagged offline device", async () => {
    const el = await mountDrawer({
      device: makeConfiguredDevice({
        name_add_mac_suffix: true,
        runtime_state: { state: DeviceState.OFFLINE },
      }),
    });
    const html = el.shadowRoot!.innerHTML;
    expect(html).toContain("dashboard.status_untracked");
    expect(html).not.toContain("dashboard.drawer_device_offline");
    expect(html).not.toContain("network-off-outline");
  });

  it("omits the whole status banner for a no-network device, flagged or not", async () => {
    for (const flagged of [false, true]) {
      const el = await mountDrawer({
        device: makeConfiguredDevice({
          name_add_mac_suffix: flagged,
          loaded_integrations: ["api"],
          runtime_state: { state: DeviceState.OFFLINE },
        }),
      });
      const root = el.shadowRoot!;
      expect(root.querySelector(".status-banner")).toBeNull();
      expect(root.querySelector(".troubleshoot-btn")).toBeNull();
      expect(root.innerHTML).not.toContain("dashboard.status_untracked");
      el.remove();
    }
  });

  it("keeps the banner for a no-network device that is online", async () => {
    const el = await mountDrawer({
      device: makeConfiguredDevice({
        loaded_integrations: ["api"],
        runtime_state: { state: DeviceState.ONLINE },
      }),
    });
    expect(el.shadowRoot!.querySelector(".status-banner.online")).not.toBeNull();
  });

  it("keeps Device Offline for an unflagged offline device", async () => {
    const el = await mountDrawer({
      device: makeConfiguredDevice({ runtime_state: { state: DeviceState.OFFLINE } }),
    });
    expect(el.shadowRoot!.innerHTML).toContain("dashboard.drawer_device_offline");
  });
});
