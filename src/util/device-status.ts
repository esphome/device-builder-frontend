/**
 * Shared status-verdict predicate so the card badge and the table's
 * status column agree on the same device.
 */
import { DeviceState } from "../api/types/devices.js";

/** OFFLINE/UNKNOWN verdicts are meaningless while `name_add_mac_suffix`
 *  is set (the suffixed broadcast never matches the config); a real
 *  ONLINE verdict still wins. */
export const isStatusUntracked = (
  state: DeviceState,
  nameAddMacSuffix: boolean
): boolean => nameAddMacSuffix && state !== DeviceState.ONLINE;
