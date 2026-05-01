import type { ConfiguredDevice } from "../api/types.js";

/**
 * Build the device's web-UI URL, or return ``""`` when the YAML didn't
 * expose a ``web_server`` port or we don't have a host to point at.
 *
 * Single source of truth for the dashboard's "Visit Web UI" affordance —
 * the table column, the device card, and the row-menu fallback all
 * share this so the host/port/protocol logic can't drift between
 * call sites. Returns empty string (not ``null``) so callers can
 * skip-render with a truthy check.
 */
export function buildWebUiUrl(device: ConfiguredDevice): string {
  if (device.web_port == null) return "";
  const host = device.address || device.ip;
  if (!host) return "";
  return `http://${host}${device.web_port === 80 ? "" : `:${device.web_port}`}`;
}
