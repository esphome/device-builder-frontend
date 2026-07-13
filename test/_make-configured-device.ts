/**
 * Shared ``ConfiguredDevice`` fixture for vitest tests.
 *
 * Lives at ``test/`` root (vitest's ``include`` glob is
 * ``test/**\/*.test.ts``, so this file isn't picked up as a no-test
 * file) so any ``test/util`` or ``test/components`` test that needs
 * a syntactically-valid ``ConfiguredDevice`` can spread off the
 * same baseline. Keeps each test focused on the field(s) it
 * actually exercises rather than re-typing every required key just
 * to satisfy the type system.
 *
 * The defaults are a benign "happy device" — online stub fields,
 * empty multi-value lists, no labels, no integrations. Tests that
 * care about a particular value pass it via *overrides*; the rest
 * fall through.
 */
import type { ConfiguredDevice, DeviceRuntimeState } from "../src/api/types/devices.js";
import { DeviceState } from "../src/api/types/devices.js";

const _BASE = {
  name: "kitchen",
  friendly_name: "Kitchen",
  configuration: "kitchen.yaml",
  comment: null,
  area: "",
  board_id: "esp32-c3-devkitm-1",
  target_platform: "esp32",
  address: "kitchen.local",
  ip: "",
  mac_address: "",
  ethernet_mac: "",
  bluetooth_mac: "",
  build_size_bytes: 0,
  labels: [],
  web_port: null,
  logger_baud_rate: null,
  current_version: "",
  loaded_integrations: [],
  runtime_state: {
    state: DeviceState.UNKNOWN,
    // Default to a live mDNS source so the happy-path fixture shows its
    // out-of-sync / update indicators as before; tests covering the mDNS-dark
    // "hide indicators" behaviour override this to "ping" / "unknown".
    active_source: "mdns",
    ip_addresses: [],
    deployed_version: "",
    deployed_config_hash: "",
    queued_update: false,
    api_encryption_active: null,
  },
  expected_config_hash: "",
  has_pending_changes: false,
  update_available: false,
  api_enabled: false,
  api_encrypted: false,
} satisfies ConfiguredDevice;

/** Overrides accepted by :func:`makeConfiguredDevice` — flat fields
 *  plus a partial ``runtime_state`` merged over the baseline's. */
export type ConfiguredDeviceOverrides = Partial<
  Omit<ConfiguredDevice, "runtime_state">
> & {
  runtime_state?: Partial<DeviceRuntimeState>;
};

/** Build a ``ConfiguredDevice`` from the shared defaults, with any
 *  fields the test cares about overridden. The return type is the
 *  full ``ConfiguredDevice`` (not ``Partial``) so consumers can
 *  pass the result anywhere a real device object is expected. */
export function makeConfiguredDevice(
  overrides: ConfiguredDeviceOverrides = {}
): ConfiguredDevice {
  const { runtime_state, ...flat } = overrides;
  return {
    ..._BASE,
    ...flat,
    runtime_state: { ..._BASE.runtime_state, ...runtime_state },
  };
}
