/**
 * Device-list search predicates shared across dashboard surfaces.
 *
 * The dashboard's render-time filter, the select-all scoping
 * helper, and the empty-state YAML-preview gate all need the
 * same answer: "does this device match the current name search?"
 * One source of truth means renaming the rule (e.g. fuzzy match,
 * friendly-name priority, accent-stripping) lands in one place.
 */

import type { ConfiguredDevice } from "../api/types/devices.js";

/**
 * True when *device*'s friendly_name (or name) or configuration
 * filename contains *loweredQuery* as a substring.
 *
 * ``loweredQuery`` must already be lower-cased; the caller
 * pre-lowers once outside the iteration loop so a 100-device
 * fleet doesn't pay a per-device ``toLowerCase`` on the needle.
 */
export function matchesDeviceName(
  device: ConfiguredDevice,
  loweredQuery: string
): boolean {
  const name = (device.friendly_name || device.name).toLowerCase();
  return (
    name.includes(loweredQuery) ||
    device.configuration.toLowerCase().includes(loweredQuery)
  );
}

/**
 * True when *mac* matches *loweredQuery* after stripping ``:`` /
 * ``-`` / ``.`` from both sides, so a user finds a device by typing
 * any of ``94:c9:60``, ``94-C9-60`` or the bare ``94c960`` — the
 * canonical wire form is ``XX:XX:XX:XX:XX:XX`` but users copy-paste
 * from router admin pages, vendor labels, etc.
 *
 * ``loweredQuery`` must already be lower-cased (matching
 * ``matchesDeviceName``). An empty MAC, or a query that is empty
 * once separators are stripped, never matches.
 *
 * Shared by the table's render-time global filter and the dashboard
 * select-all scoping helper so the two agree on which rows a MAC
 * search makes visible — see the module docstring's single-source-
 * of-truth note.
 */
export function matchesMacAddress(
  mac: string | null | undefined,
  loweredQuery: string
): boolean {
  if (!mac) return false;
  const strippedQuery = loweredQuery.replace(/[:.-]/g, "");
  if (!strippedQuery) return false;
  return mac.toLowerCase().replace(/[:.-]/g, "").includes(strippedQuery);
}

/**
 * Structural subset of a dashboard device row consulted by the
 * table's full-text global filter. Declared here (rather than
 * importing the component's ``DeviceRow``) so this leaf util keeps
 * no dependency on the dashboard component layer — any object with
 * these fields can be matched.
 */
export interface DeviceRowSearchFields {
  name: string;
  friendly_name: string;
  config: string;
  address: string;
  ip_addresses: string[];
  platform: string;
  mac_address: string | null | undefined;
}

/**
 * True when *row* matches *loweredQuery* across any of its
 * user-visible identity fields: friendly_name (or name),
 * configuration filename, address, any resolved IP, platform, or
 * MAC address (separator-insensitive, via ``matchesMacAddress``).
 *
 * ``loweredQuery`` must already be lower-cased (matching
 * ``matchesDeviceName`` / ``matchesMacAddress``). An empty query
 * matches every row, mirroring the table filter's match-all
 * behaviour when the search box is cleared.
 *
 * Centralising the row filter here keeps the table's render-time
 * global filter and the select-all scoping helper agreeing on
 * which rows a search makes visible — see the module docstring's
 * single-source-of-truth note.
 */
export function matchesDeviceRow(
  row: DeviceRowSearchFields,
  loweredQuery: string
): boolean {
  if (!loweredQuery) return true;
  if (
    (row.friendly_name || row.name).toLowerCase().includes(loweredQuery) ||
    row.config.toLowerCase().includes(loweredQuery) ||
    row.address.toLowerCase().includes(loweredQuery) ||
    row.ip_addresses.some((ip) => ip.toLowerCase().includes(loweredQuery)) ||
    row.platform.toLowerCase().includes(loweredQuery)
  ) {
    return true;
  }
  return matchesMacAddress(row.mac_address, loweredQuery);
}
