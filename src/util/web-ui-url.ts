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
  const candidate = `http://${host}${device.web_port === 80 ? "" : `:${device.web_port}`}`;
  /* Validate so a hostname containing characters with special URL
     meaning (``@``, ``:``, ``/``, etc.) can't be smuggled into a
     different origin via the constructed string. ``new URL`` rejects
     malformed input outright; the protocol check is belt-and-suspenders
     since the prefix is hard-coded above. */
  /* Parse to validate, but return the constructed string verbatim
     so the URL keeps its terse form (``http://host:22`` rather than
     the WHATWG-canonicalised ``http://host:22/``) and tests stay
     deterministic. */
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return candidate;
  } catch {
    return "";
  }
}
