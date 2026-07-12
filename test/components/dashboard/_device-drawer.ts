import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { ESPHomeDeviceDrawer } from "../../../src/components/dashboard/device-drawer.js";
import { mount } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";

/**
 * Drawer-footer test harness (drawer opens by default).
 *
 * Callers still need their own ``vi.mock`` lines for the webawesome icon
 * module and ``device-drawer-content.js`` (the body pulls in noisy
 * ``<wa-button>`` children) — vi.mock is hoisted per test module.
 */
export async function mountDrawer(
  props: Partial<ESPHomeDeviceDrawer>
): Promise<ESPHomeDeviceDrawer> {
  return mount(new ESPHomeDeviceDrawer(), { open: true, ...props });
}

/** The footer's Update-or-Install accent button. */
export function footerAccent(el: ESPHomeDeviceDrawer): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(".footer .action--accent")!;
}

/** Device with an update available (both versions known). */
export function updateAvailableDevice(): ConfiguredDevice {
  return makeConfiguredDevice({
    update_available: true,
    runtime_state: { deployed_version: "2024.6.0" },
    current_version: "2024.12.0",
  });
}
