import type { ConfiguredDevice } from "../api/types/devices.js";

// Whether mDNS is the channel currently driving the device's online state.
// Deliberately unexported: for gating the deployed identity (version /
// config hash) use deployedIdentityTrusted below, never this directly.
const mdnsOnline = (d: ConfiguredDevice): boolean =>
  d.runtime_state.active_source === "mdns";

// Whether the deployed identity (version / config hash) is trustworthy.
// Two evidence channels, one per disjunct. An api: device broadcasts the
// identity on _esphomelib._tcp, the service mdns ownership rides on —
// and the api_enabled guard there is load-bearing: a device without
// api: can also hold active_source === "mdns", but off a bare A-record
// resolve that vouches for reachability only, never identity.
// Everywhere mdns can't vouch, the backend ships its own first-party
// evidence as runtime_state.deployed_identity_live (session-only). Where
// mDNS can reach the device, the backend clears the flag when mDNS takes
// ownership, so a powered-down device blanks through the announce
// lifecycle. In an mDNS-dark deployment the flag deliberately never
// expires — no evidence of staleness can arrive, so the last-confirmed
// identity stays up and reachability is signalled separately by the
// state indicator. Full semantics: docs/API.md in the backend repo
// (esphome/device-builder), Device.runtime_state.
export const deployedIdentityTrusted = (d: ConfiguredDevice): boolean =>
  (d.api_enabled && mdnsOnline(d)) || d.runtime_state.deployed_identity_live;

// Whether to SHOW the "modified" (needs-install) and "update available"
// indicators, gated so a stale untrusted value can't flag a false "out of
// sync". The raw truth stays on the device fields (``has_pending_changes`` /
// ``update_available``); these say whether to surface it. Every indicator site
// derives from these so the rule lives in one place.
//
// ``update_available`` (``deployed_version`` vs ``current_version``) is purely
// deployed-identity-sourced, so it always needs a trusted deployed identity.
// ``has_pending_changes`` is only identity-dependent when it came from the
// config-hash compare (``pending_changes_via_hash``); a local mtime-driven
// edit is trustworthy without it, so it still cues "install".
export const showPendingChanges = (d: ConfiguredDevice): boolean =>
  d.has_pending_changes === true &&
  (deployedIdentityTrusted(d) || d.pending_changes_via_hash !== true);

export const showUpdateAvailable = (d: ConfiguredDevice): boolean =>
  d.update_available === true && deployedIdentityTrusted(d);
