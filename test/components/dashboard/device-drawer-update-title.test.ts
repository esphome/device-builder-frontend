// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
// Stub the drawer body; see _device-drawer.ts.
vi.mock("../../../src/components/dashboard/device-drawer-content.js", () => ({}));

import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { footerAccent, mountDrawer, updateAvailableDevice } from "./_device-drawer.js";

describe("device-drawer footer Update title", () => {
  it("wires installed + target versions into the Update button title", async () => {
    // Identity localize keeps the key; the version key proves both versions
    // threaded through (helper branch logic is unit-tested in update-tooltip).
    const el = await mountDrawer({ device: updateAvailableDevice() });
    expect(footerAccent(el).title).toBe("dashboard.update_available_version");
  });

  it("falls back to the plain Update title when a version is missing", async () => {
    const el = await mountDrawer({
      device: makeConfiguredDevice({
        update_available: true,
        runtime_state: { deployed_version: "2024.6.0" },
      }),
    });
    expect(footerAccent(el).title).toBe("dashboard.drawer_update");
  });
});
