import type { ConfiguredDevice } from "../api/types/devices.js";

// The deployed version / config hash come only from the device's mDNS
// broadcast, so they are trustworthy only while mDNS is the live source. When
// mDNS is dark (a ping/MQTT-only "odd setup", e.g. a Docker-bridge dashboard),
// those values go stale, so we gate the out-of-sync / update indicators on a
// live mDNS rather than flagging a false "out of sync". The device reappears
// as out-of-sync once mDNS hears from it again.
export const mdnsOnline = (d: ConfiguredDevice): boolean => d.active_source === "mdns";

// The "modified" (out-of-sync) and "update available" signals, gated on a live
// mDNS. Every indicator site derives from these so the rule lives in one place.
export const devicePendingChanges = (d: ConfiguredDevice): boolean =>
  d.has_pending_changes === true && mdnsOnline(d);

export const deviceUpdateAvailable = (d: ConfiguredDevice): boolean =>
  d.update_available === true && mdnsOnline(d);
