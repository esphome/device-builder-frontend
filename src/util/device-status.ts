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

/** Anchors the wire's `offline_seconds` to the browser clock on receipt, so
 *  the duration ticks locally and clock skew with the server can't show. */
export const anchorOffline = (
  device: ConfiguredDevice,
  nowMs = Date.now()
): ConfiguredDevice => {
  const age = device.runtime_state.offline_seconds;
  return {
    ...device,
    runtime_state: {
      ...device.runtime_state,
      offline_since: age === null ? null : nowMs / 1000 - age,
    },
  };
};

/** Seconds offline, or `null` when no duration applies. */
export const offlineSeconds = (
  state: DeviceState,
  nameAddMacSuffix: boolean,
  offlineSince: number | null,
  nowMs = Date.now()
): number | null =>
  state === DeviceState.OFFLINE &&
  !isStatusUntracked(state, nameAddMacSuffix) &&
  offlineSince !== null
    ? nowMs / 1000 - offlineSince
    : null;

/** Facet bucket id for untracked devices (beside the `DeviceState` values). */
export const UNTRACKED_STATE = "untracked";

/** The state bucket for *device*: `untracked` when the flag suppresses
 *  an OFFLINE/UNKNOWN verdict, else the raw runtime state. */
export const effectiveDeviceState = (
  device: ConfiguredDevice
): DeviceState | typeof UNTRACKED_STATE =>
  isStatusUntracked(device.runtime_state.state, device.name_add_mac_suffix)
    ? UNTRACKED_STATE
    : device.runtime_state.state;
