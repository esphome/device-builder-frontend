import { formatCountdown } from "./relative-time.js";

/**
 * The mDNS "Expires in" decision shared by the device drawer and the
 * status-report prefill, so the report's mDNS line always matches what
 * the drawer shows.
 */

// Only surface the "Expires in" hint once the device has been quiet for
// longer than this, so a freshly-heard healthy device shows no shrinking
// timer (which would read as a false alarm). A UI threshold, not tied to
// any record's TTL.
export const SHOW_EXPIRES_HINT_AFTER_SECONDS = 120;

/**
 * Remaining seconds for the countdown, or null when no hint should
 * show: no mDNS signal, no PTR TTL, heard too recently, or the device
 * is already OFFLINE (by then the record has expired and the snapshot
 * can be stale).
 */
export function mdnsExpiryRemaining(
  ageSeconds: number | null,
  ptrTtlSeconds: number | null,
  deviceOffline: boolean
): number | null {
  if (
    deviceOffline ||
    ptrTtlSeconds === null ||
    ageSeconds === null ||
    ageSeconds <= SHOW_EXPIRES_HINT_AFTER_SECONDS
  ) {
    return null;
  }
  return Math.max(0, ptrTtlSeconds - ageSeconds);
}

/**
 * The mDNS-row answer for the status report's prefill, in English (the
 * form is English-only): the countdown when the drawer would show one,
 * else why there isn't one.
 */
export function mdnsExpirySummary(
  ageSeconds: number | null,
  ptrTtlSeconds: number | null,
  deviceOffline: boolean
): string {
  if (ageSeconds === null) return "no mDNS row";
  const remaining = mdnsExpiryRemaining(ageSeconds, ptrTtlSeconds, deviceOffline);
  if (remaining === null) {
    return deviceOffline
      ? "no expiry countdown (device offline)"
      : "no expiry countdown (heard recently)";
  }
  // Below 1s the countdown would read "0s", but the record isn't gone
  // yet — zeroconf evicts on a periodic sweep — so say "soon".
  return remaining < 1
    ? "Expires soon"
    : `Expires in ${formatCountdown(remaining, "en")}`;
}
