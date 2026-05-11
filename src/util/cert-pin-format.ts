/**
 * Display formatting for the receiver's SPKI fingerprint.
 *
 * The wire form of ``pin_sha256`` is a contiguous 64-char
 * lowercase hex string. For OOB verification (the user reads
 * the fingerprint off the receiver's Build host card and
 * compares to what the sender's pair dialog observed on the
 * TLS handshake), space-separated byte pairs are easier to
 * scan visually:
 *
 *   "abcdef0123456789..."  →  "ab cd ef 01 23 45 67 89 ..."
 *
 * Mirrors the backend's ``DashboardIdentity.pin_sha256_formatted``
 * property so the frontend display matches what the receiver-side
 * Settings card shows on the dashboard's HTML rendering of its
 * own identity.
 */

/**
 * Format a contiguous lowercase-hex SHA-256 fingerprint as
 * space-separated byte pairs.
 *
 * Doesn't validate the input length — a malformed pin (wrong
 * length, non-hex chars) renders verbatim with the same
 * pair-splitting applied. The Settings card surfaces invalid
 * pins via a separate "couldn't load identity" error path,
 * not by hiding malformed strings here.
 *
 * Returns an empty string for empty input.
 */
export function formatPinSha256(pin: string): string {
  if (!pin) return "";
  const pairs: string[] = [];
  for (let i = 0; i < pin.length; i += 2) {
    pairs.push(pin.slice(i, i + 2));
  }
  return pairs.join(" ");
}
