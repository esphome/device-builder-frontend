import type { ConfiguredDevice } from "../api/types/devices.js";

// Whether mDNS is the channel currently driving the device's online state.
// Deliberately unexported: for gating the deployed identity (version /
// config hash) use deployedIdentityTrusted below, never this directly —
// this predicate can never be true for a device without api:.
const mdnsOnline = (d: ConfiguredDevice): boolean =>
  d.runtime_state.active_source === "mdns";

// Whether the mDNS-sourced deployed identity (version / config hash) is
// trustworthy. An api: device broadcasts it on _esphomelib._tcp, the same
// service that claims active_source === "mdns", so that source doubles as the
// freshness signal: when mDNS is dark (a ping/MQTT-only "odd setup", e.g. a
// Docker-bridge dashboard) the values go stale, so blanking them avoids a
// false "out of sync". A device without api: broadcasts the same identity
// trio on _http._tcp (ESPHome 2026.7.0+), which by backend design never
// claims reachability, so active_source can't vouch for it and would blank
// the values forever; trust what the backend delivered instead. The drawer's
// mDNS-stale warning already covers the "reachable but mDNS dark, values may
// be stale" case for these devices; a fully OFFLINE device falls outside that
// warning yet still renders its last-heard identity — accepted, since that's
// the best information available for a powered-down device.
export const deployedIdentityTrusted = (d: ConfiguredDevice): boolean =>
  d.api_enabled ? mdnsOnline(d) : true;

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
