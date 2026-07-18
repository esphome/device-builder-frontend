import { type ConfiguredDevice, DeviceState } from "../api/types/devices.js";

/**
 * True when nothing shows this device ever ran ESPHome firmware — it
 * cannot come online by itself, so a queued OTA install would wait
 * forever and the first install has to go over a cable.
 *
 * The evidence fields are sidecar-persisted (they survive backend
 * restarts) and a successful flash pins ``deployed_version``
 * optimistically, so the flag flips as soon as the first install lands.
 */
export function isNeverFlashed(device: ConfiguredDevice | null | undefined): boolean {
  if (!device) return false;
  if (device.runtime_state.state === DeviceState.ONLINE) return false;
  // Not evidence: expected_config_hash / build_size_bytes (set by the
  // deferred compile itself) and ip (DNS pre-resolve can populate it
  // for a board that never ran).
  return (
    !device.runtime_state.deployed_version &&
    !device.runtime_state.deployed_config_hash &&
    !device.mac_address
  );
}
