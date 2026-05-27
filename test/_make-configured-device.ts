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
import type { ConfiguredDevice } from "../src/api/types.js";
import { DeviceState } from "../src/api/types.js";

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
  ip_addresses: [],
  mac_address: "",
  ethernet_mac: "",
  bluetooth_mac: "",
  build_size_bytes: 0,
  labels: [],
  web_port: null,
  current_version: "",
  deployed_version: "",
  loaded_integrations: [],
  state: DeviceState.UNKNOWN,
  expected_config_hash: "",
  deployed_config_hash: "",
  has_pending_changes: false,
  update_available: false,
  api_enabled: false,
  api_encrypted: false,
  api_encryption_active: null,
} satisfies ConfiguredDevice;

/** Build a ``ConfiguredDevice`` from the shared defaults, with any
 *  fields the test cares about overridden. The return type is the
 *  full ``ConfiguredDevice`` (not ``Partial``) so consumers can
 *  pass the result anywhere a real device object is expected. */
export function makeConfiguredDevice(
  overrides: Partial<ConfiguredDevice> = {}
): ConfiguredDevice {
  return { ..._BASE, ...overrides };
}
