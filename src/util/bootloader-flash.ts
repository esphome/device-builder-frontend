import type { ConfiguredDevice } from "../api/types/devices.js";

// Whether the install dialog offers the OTA bootloader-update action. Two
// halves: the YAML enables partition access (`ota_partition_access`), and the
// running firmware was built from that config (hash match) — the device-side
// OTA handler only exists when the flag was compiled in, so a device still
// running a pre-flag build would reject the flash. Deliberately not
// mDNS-gated: the optimistic post-flash hash sync must surface the option in
// mDNS-dark deployments too.
export const canFlashBootloader = (d: ConfiguredDevice | null | undefined): boolean =>
  !!d &&
  d.ota_partition_access === true &&
  !!d.runtime_state.deployed_config_hash &&
  d.runtime_state.deployed_config_hash === d.expected_config_hash;
