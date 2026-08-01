import type { ReachabilitySource } from "../api/types/reachability.js";

/**
 * The mDNS "Expires in" decision shared by the device drawer and the
 * status-report prefill. The classifier owns every gate and threshold;
 * consumers only translate phases into their surface's wording, so the
 * report's mDNS line can never diverge from what the drawer shows.
 */

// Only surface the "Expires in" hint once the device has been quiet for
// longer than this, so a freshly-heard healthy device shows no shrinking
// timer (which would read as a false alarm). A UI threshold, not tied to
// any record's TTL.
const SHOW_EXPIRES_HINT_AFTER_SECONDS = 120;

export type MdnsExpiryPhase =
  | { kind: "no-signal" }
  | { kind: "offline" }
  | { kind: "inactive-source" }
  | { kind: "no-ttl" }
  | { kind: "fresh" }
  | { kind: "soon"; ttl: number }
  | { kind: "countdown"; remaining: number; ttl: number };

/**
 * Classify the countdown decision. Only ``soon`` and ``countdown``
 * surface a hint; the other phases name why there isn't one, in
 * priority order: never heard, device already OFFLINE (by then the
 * record has expired and the snapshot can be stale), mDNS not the
 * active source, no PTR TTL, heard too recently.
 */
export function mdnsExpiryPhase(
  ageSeconds: number | null,
  ptrTtlSeconds: number | null,
  deviceOffline: boolean,
  activeSource: ReachabilitySource
): MdnsExpiryPhase {
  if (ageSeconds === null) return { kind: "no-signal" };
  if (deviceOffline) return { kind: "offline" };
  if (activeSource !== "mdns") return { kind: "inactive-source" };
  if (ptrTtlSeconds === null) return { kind: "no-ttl" };
  if (ageSeconds <= SHOW_EXPIRES_HINT_AFTER_SECONDS) return { kind: "fresh" };
  const remaining = Math.max(0, ptrTtlSeconds - ageSeconds);
  // Below 1s the countdown would read "0s", but the record isn't gone
  // yet — zeroconf evicts on a periodic (~10s) sweep.
  return remaining < 1
    ? { kind: "soon", ttl: ptrTtlSeconds }
    : { kind: "countdown", remaining, ttl: ptrTtlSeconds };
}
