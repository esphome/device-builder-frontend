import type { ConfiguredDevice } from "../api/types/devices.js";

// The deployed version / config hash come only from the device's mDNS
// broadcast, so they are trustworthy only while mDNS is the live source. When
// mDNS is dark (a ping/MQTT-only "odd setup", e.g. a Docker-bridge dashboard),
// those values go stale, so we gate the out-of-sync / update indicators on a
// live mDNS rather than flagging a false "out of sync". The device reappears
// as out-of-sync once mDNS hears from it again.
export const mdnsOnline = (d: ConfiguredDevice): boolean =>
  d.runtime_state.active_source === "mdns";

// Whether to SHOW the "modified" (needs-install) and "update available"
// indicators, gated so a stale mDNS-dark value can't flag a false "out of
// sync". The raw truth stays on the device fields (``has_pending_changes`` /
// ``update_available``); these say whether to surface it. Every indicator site
// derives from these so the rule lives in one place.
//
// ``update_available`` (device version vs server) is purely mDNS-sourced, so it
// always needs a live mDNS. ``has_pending_changes`` is only mDNS-dependent when
// it came from the config-hash compare (``pending_changes_via_hash``); a local
// mtime-driven edit is trustworthy without mDNS, so it still cues "install".
export const showPendingChanges = (d: ConfiguredDevice): boolean =>
  d.has_pending_changes === true &&
  (mdnsOnline(d) || d.pending_changes_via_hash !== true);

export const showUpdateAvailable = (d: ConfiguredDevice): boolean =>
  d.update_available === true && mdnsOnline(d);
