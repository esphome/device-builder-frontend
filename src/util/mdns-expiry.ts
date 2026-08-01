/**
 * The mDNS "Expires in" decisions shared by the device drawer and the
 * status-report prefill, so the report's mDNS line always matches what
 * the drawer shows.
 */

// Only surface the "Expires in" hint once the device has been quiet for
// longer than this, so a freshly-heard healthy device shows no shrinking
// timer (which would read as a false alarm). A UI threshold, not tied to
// any record's TTL.
const SHOW_EXPIRES_HINT_AFTER_SECONDS = 120;

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
 * Whether the countdown should read "soon" instead of a number. Below
 * 1s it would read "0s", but the record isn't gone yet — zeroconf
 * evicts on a periodic (~10s) sweep.
 */
export function mdnsExpiresSoon(remainingSeconds: number): boolean {
  return remainingSeconds < 1;
}
