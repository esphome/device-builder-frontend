import type { ConfiguredDevice } from "../../api/types/devices.js";

/**
 * The live ``_devices`` object matching *current*'s configuration, or ``null``
 * when the device left the list. Device state events replace list objects
 * wholesale, so any snapshot held across renders must re-link through this on
 * every ``_devices`` change or it silently stops seeing updates.
 */
export function relinkLive(
  devices: ConfiguredDevice[],
  current: ConfiguredDevice
): ConfiguredDevice | null {
  return devices.find((d) => d.configuration === current.configuration) ?? null;
}
