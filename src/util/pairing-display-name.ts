import type { FirmwareJob } from "../api/types/firmware-jobs.js";
import type { PairingSummary, PeerSummary } from "../api/types/remote-build.js";
import { friendlyHostname } from "./hostname.js";
import { remoteBuildPeerName } from "./remote-build-peer-name.js";

/**
 * Display name for a paired build server (offloader side).
 *
 * A label the user typed always wins. A label that still equals
 * the hostname-derived prefill (the pair wizard's default, and
 * what the walkthrough's paste-the-address flow produces) is
 * replaced by the receiver's handshake-advertised friendly name
 * when one has been captured — with the HA add-on container
 * hostname mapped to "Home Assistant App" the same way discovery
 * rows are.
 */
export function pairingDisplayName(pairing: PairingSummary): string {
  if (pairing.label !== friendlyHostname(pairing.receiver_hostname)) {
    return pairing.label;
  }
  return remoteBuildPeerName({
    friendly_name: pairing.friendly_name,
    name: pairing.label,
    ha_addon: pairing.ha_addon,
  });
}

/**
 * Display name for a job's build server, preferring the live pairing.
 *
 * `FirmwareJob.source_label` is a creation-time snapshot; when the
 * pairing is still known (by `source_pin_sha256`) the live row's
 * display name reflects renames and the handshake friendly name.
 */
export function jobSourceDisplayName(
  pairings: Map<string, PairingSummary> | null | undefined,
  pin: string | undefined,
  fallbackLabel: string
): string {
  const pairing = pin ? pairings?.get(pin) : undefined;
  return pairing ? pairingDisplayName(pairing) : fallbackLabel;
}

/**
 * Display name for a paired offloader (receiver side).
 *
 * The receiver can't derive "was this label auto-prefilled" from a
 * hostname it never sees, so the offloader sends `label_auto`
 * explicitly; old offloaders never do, keeping their label
 * authoritative.
 */
export function peerDisplayName(peer: PeerSummary): string {
  if (!peer.label_auto) {
    return peer.label;
  }
  return remoteBuildPeerName({
    friendly_name: peer.friendly_name,
    name: peer.label,
    ha_addon: peer.ha_addon,
  });
}

/**
 * Display name for a receiver-side job's submitting offloader.
 *
 * Mirrors `jobSourceDisplayName`: `remote_peer_label` is the
 * submit-time snapshot, the live `PeerSummary` (keyed on
 * `job.remote_peer`, the offloader's dashboard_id) wins when known.
 */
export function jobPeerDisplayName(
  peers: PeerSummary[] | null | undefined,
  job: Pick<FirmwareJob, "remote_peer" | "remote_peer_label">
): string {
  const peer = job.remote_peer
    ? peers?.find((p) => p.dashboard_id === job.remote_peer)
    : undefined;
  return peer ? peerDisplayName(peer) : job.remote_peer_label || job.remote_peer || "";
}
