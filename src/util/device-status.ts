/**
 * Shared status verdict so the card badge, table column, drawer
 * header, and state facet agree on the same device.
 */
import type { ConfiguredDevice } from "../api/types/devices.js";
import { DeviceState } from "../api/types/devices.js";
import { NETWORK_SECTIONS } from "./network-sections.js";

/** OFFLINE/UNKNOWN verdicts are meaningless while `name_add_mac_suffix`
 *  is set (the suffixed broadcast never matches the config); a real
 *  ONLINE verdict still wins. */
export const isStatusUntracked = (
  state: DeviceState,
  nameAddMacSuffix: boolean
): boolean => nameAddMacSuffix && state !== DeviceState.ONLINE;

/** True when the compiled integrations prove the config has no network
 *  component. An empty list (never compiled) proves nothing. */
export const hasNoNetwork = (loadedIntegrations: readonly string[]): boolean =>
  loadedIntegrations.length > 0 &&
  !NETWORK_SECTIONS.some((s) => loadedIntegrations.includes(s));

/** A device that can never be seen on the network shows no status at
 *  all; a real ONLINE verdict still wins (e.g. stale compile storage).
 *  Takes precedence over the untracked state. */
export const isStatusHidden = (state: DeviceState, noNetwork: boolean): boolean =>
  noNetwork && state !== DeviceState.ONLINE;

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
  noNetwork: boolean,
  offlineSince: number | null,
  nowMs = Date.now()
): number | null =>
  state === DeviceState.OFFLINE &&
  !isStatusHidden(state, noNetwork) &&
  !isStatusUntracked(state, nameAddMacSuffix) &&
  offlineSince !== null
    ? nowMs / 1000 - offlineSince
    : null;

/** Facet bucket id for untracked devices (beside the `DeviceState` values). */
export const UNTRACKED_STATE = "untracked";

/** The state bucket for *device*: `null` when it shows no status (no
 *  network), `untracked` when the flag suppresses an OFFLINE/UNKNOWN
 *  verdict, else the raw runtime state. */
export const effectiveDeviceState = (
  device: ConfiguredDevice
): DeviceState | typeof UNTRACKED_STATE | null =>
  isStatusHidden(device.runtime_state.state, hasNoNetwork(device.loaded_integrations))
    ? null
    : isStatusUntracked(device.runtime_state.state, device.name_add_mac_suffix)
      ? UNTRACKED_STATE
      : device.runtime_state.state;
