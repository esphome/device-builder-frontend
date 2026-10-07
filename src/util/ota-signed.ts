import type { ConfiguredDevice } from "../api/types/devices.js";

/**
 * True when the running firmware only accepts signed OTA images and this
 * config's builds aren't signed, so the next install has to go over USB.
 * A key the device doesn't trust can't be detected from the wire.
 */
export function otaNeedsUsb(device: ConfiguredDevice | null | undefined): boolean {
  return !!device?.runtime_state.ota_signed && !device.ota_signing_key;
}
