// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
// The drawer body renders children that pull in <wa-button> (form-associated,
// noisy under happy-dom); the footer under test uses plain buttons, so stubbing
// the body keeps the mount light and quiet.
vi.mock("../../../src/components/dashboard/device-drawer-content.js", () => ({}));

import { ESPHomeDeviceDrawer } from "../../../src/components/dashboard/device-drawer.js";
import { mount } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";

function footerAccentTitle(el: ESPHomeDeviceDrawer): string | null {
  return el.shadowRoot!.querySelector<HTMLElement>(".footer .action--accent")!.title;
}

describe("device-drawer footer Update title", () => {
  it("wires installed + target versions into the Update button title", async () => {
    // Identity localize keeps the key; the version key proves both versions
    // threaded through (helper branch logic is unit-tested in update-tooltip).
    const el = await mount(new ESPHomeDeviceDrawer(), {
      open: true,
      device: makeConfiguredDevice({
        update_available: true,
        runtime_state: { deployed_version: "2024.6.0" },
        current_version: "2024.12.0",
      }),
    });
    expect(footerAccentTitle(el)).toBe("dashboard.update_available_version");
  });

  it("falls back to the plain Update title when a version is missing", async () => {
    const el = await mount(new ESPHomeDeviceDrawer(), {
      open: true,
      device: makeConfiguredDevice({
        update_available: true,
        runtime_state: { deployed_version: "2024.6.0" },
      }),
    });
    expect(footerAccentTitle(el)).toBe("dashboard.drawer_update");
  });
});
