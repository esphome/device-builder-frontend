import type { ConfiguredDevice } from "../api/types/devices.js";

// Whether mDNS is the channel currently driving the device's online state.
// Deliberately unexported: for gating the deployed identity (version /
// config hash) use deployedIdentityTrusted below, never this directly.
const mdnsOnline = (d: ConfiguredDevice): boolean =>
  d.runtime_state.active_source === "mdns";

// Whether the deployed identity (version / config hash) is trustworthy.
// Two evidence channels, one per disjunct. An api: device broadcasts the
// identity on _esphomelib._tcp, the same service that claims
// active_source === "mdns", so mdns ownership doubles as the freshness
// signal — and the api_enabled guard on that disjunct is load-bearing:
// a device without api: can also hold active_source === "mdns", but off
// a bare A-record resolve that vouches for reachability only, never
// identity. Everywhere mdns ownership can't vouch, the backend tracks
// its own first-party evidence and ships it as
// runtime_state.deployed_identity_live: the _http._tcp identity TXT for
// devices without api: (ESPHome 2026.7.0+), a direct Native API
// device_info connection for api: devices mDNS can't reach (the
// Docker-bridge dashboard), and the dashboard's own flash. Session-only,
// false on backend cold start until evidence arrives; the backend
// clears it when mDNS takes ownership of an api: device, so a
// powered-down device still blanks through the announce lifecycle
// rather than showing its last-heard identity.
export const deployedIdentityTrusted = (d: ConfiguredDevice): boolean =>
  (d.api_enabled && mdnsOnline(d)) || d.runtime_state.deployed_identity_live;

// Whether to SHOW the "modified" (needs-install) and "update available"
// indicators, gated so a stale mDNS-dark value can't flag a false "out of
// sync". The raw truth stays on the device fields (``has_pending_changes`` /
// ``update_available``); these say whether to surface it. Every indicator site
// derives from these so the rule lives in one place.
//
// ``update_available`` (``deployed_version`` vs ``current_version``) is purely
// mDNS-sourced, so it always needs a trusted deployed identity.
// ``has_pending_changes`` is only
// mDNS-dependent when it came from the config-hash compare
// (``pending_changes_via_hash``); a local mtime-driven edit is trustworthy
// without mDNS, so it still cues "install".
export const showPendingChanges = (d: ConfiguredDevice): boolean =>
  d.has_pending_changes === true &&
  (deployedIdentityTrusted(d) || d.pending_changes_via_hash !== true);

export const showUpdateAvailable = (d: ConfiguredDevice): boolean =>
  d.update_available === true && deployedIdentityTrusted(d);
