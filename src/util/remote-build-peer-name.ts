import { trimTrailingDot } from "./hostname.js";

/**
 * Home Assistant's Supervisor names the ESPHome add-on container
 * `<repo-hash>-esphome`, with `-beta` / `-dev` suffixes for those channels.
 * That's what the add-on advertises as its mDNS `friendly_name` (the container
 * hostname), so we can recognise it and show a human label without waiting for
 * the backend `ha_addon` signal — which, when present, is treated as an
 * additive confirmation.
 */
const HA_ADDON_HOSTNAME = /^[0-9a-f]{8}-esphome(?:-(beta|dev))?$/i;

interface DiscoveredPeer {
  friendly_name?: string;
  name: string;
  ha_addon?: boolean;
}

/**
 * Display label for a discovered remote-build peer.
 *
 * Maps the HA add-on's Supervisor-assigned hostname to
 * `Home Assistant App` (plus `(Beta)` / `(Dev)` for those channels); otherwise
 * prefers `friendly_name`, falling back to the mDNS instance `name`.
 */
export function remoteBuildPeerName(peer: DiscoveredPeer): string {
  const base = trimTrailingDot((peer.friendly_name ?? "").trim() || peer.name);
  const match = HA_ADDON_HOSTNAME.exec(base);
  if (match) {
    const flavor = match[1]?.toLowerCase();
    if (flavor === "dev") return "Home Assistant App (Dev)";
    if (flavor === "beta") return "Home Assistant App (Beta)";
    return "Home Assistant App";
  }
  return peer.ha_addon ? "Home Assistant App" : base;
}
