import { vi } from "vitest";

import { flush, identityLocalize } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import type { ESPHomeAPI } from "../../../src/api/esphome-api.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { ESPHomeDeviceDrawerContent } from "../../../src/components/dashboard/device-drawer-content.js";

/**
 * Drawer-content test harness (stubbed api + identity localize).
 *
 * Callers still need their own ``vi.mock`` lines for the webawesome
 * icon module and the labels editor — vi.mock is hoisted per test
 * module.
 */
export async function mountDrawerContent(
  device: ConfiguredDevice = makeConfiguredDevice()
) {
  const unsubscribe = vi.fn().mockResolvedValue(undefined);
  const api = {
    connectionGeneration: 1,
    subscribeDeviceReachability: vi.fn().mockResolvedValue({ unsubscribe }),
  };
  const el = new ESPHomeDeviceDrawerContent();
  el.device = device;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._api = api as unknown as ESPHomeAPI;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._localize = identityLocalize;
  document.body.appendChild(el);
  await el.updateComplete;
  await flush();
  return { el, api: api as unknown as ESPHomeAPI, unsubscribe };
}
