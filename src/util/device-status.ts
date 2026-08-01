/**
 * Shared status verdict so the card badge, table column, drawer
 * header, and state facet agree on the same device.
 */
import type { ConfiguredDevice } from "../api/types/devices.js";
import { DeviceState } from "../api/types/devices.js";

/** OFFLINE/UNKNOWN verdicts are meaningless while `name_add_mac_suffix`
 *  is set (the suffixed broadcast never matches the config); a real
 *  ONLINE verdict still wins. */
export const isStatusUntracked = (
  state: DeviceState,
  nameAddMacSuffix: boolean
): boolean => nameAddMacSuffix && state !== DeviceState.ONLINE;

/** Facet bucket id for untracked devices (beside the `DeviceState` values). */
export const UNTRACKED_STATE = "untracked";

/** The state bucket for *device*: `untracked` when the flag suppresses
 *  an OFFLINE/UNKNOWN verdict, else the raw runtime state. */
export const effectiveDeviceState = (device: ConfiguredDevice): string =>
  isStatusUntracked(device.runtime_state.state, device.name_add_mac_suffix)
    ? UNTRACKED_STATE
    : device.runtime_state.state;
