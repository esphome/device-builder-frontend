import type { IdentityView } from "../api/types/remote-build.js";

/**
 * The address a sending dashboard pairs with, or null while the
 * listener is down.
 *
 * Prefers the mDNS-advertised hostname the receiver broadcasts;
 * falls back to the hostname the browser reached this dashboard on
 * when no advertiser is attached (zeroconf unavailable).
 */
export function pairingAddress(identity: IdentityView | null): string | null {
  if (!identity?.listener_port) return null;
  const host = identity.listener_host || window.location.hostname;
  return formatHostPort(host, identity.listener_port);
}

/** host:port, bracketing IPv6 literals. */
export function formatHostPort(host: string, port: number): string {
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
}
