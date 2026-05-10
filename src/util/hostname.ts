/**
 * Hostname display + comparison helpers.
 *
 * mDNS hostnames flow through the dashboard in their FQDN-root
 * form (`MyDashboard.local.`) — trailing dot, mixed case from
 * whatever the device originally registered. Two recurring
 * problems fall out of that:
 *
 * - **Display:** the trailing dot is just protocol noise to a
 *   human reader; users typed `mydashboard.local` and expect to
 *   see `mydashboard.local` back. ``trimTrailingDot`` is the
 *   one-line fix at every render site (the unpair confirm
 *   message, the "connected to" target line, etc.).
 *
 * - **Comparison:** "I'm already paired with this host" needs to
 *   match `mydashboard.local` (the persisted pairing) against
 *   `MyDashboard.local.` (the freshly-discovered mDNS row). Direct
 *   string equality misses; lowercasing + dropping the trailing
 *   dot makes the comparison the case-insensitive equality DNS
 *   already guarantees per RFC 4343.
 *
 * Display path keeps original case so users see what they
 * typed; compare path normalises so the dedupe logic can't
 * silently miss a row whose case drifted between discovery and
 * persistence.
 */

/**
 * Strip a single trailing FQDN-root dot from *host*.
 *
 * Returns the input unchanged when the trailing dot is absent
 * (IP literals, plain short names, manual entries that don't
 * happen to have an mDNS-style dot). Does NOT lowercase; this
 * is the display-side helper, so the user sees the casing they
 * registered with.
 */
export function trimTrailingDot(host: string): string {
  return host.endsWith(".") ? host.slice(0, -1) : host;
}

/**
 * Derive a friendly-label-shaped string from a raw hostname.
 *
 * Trims surrounding whitespace, drops a trailing FQDN-root dot,
 * and strips the canonical mDNS ``.local`` suffix when present.
 * Returns the input shape unchanged for IP literals, plain short
 * names, and manual entries that don't follow the
 * ``<short-name>.local`` pattern. Preserves case so the user
 * sees what they registered with — this is a *label* derivation
 * (default for the receiver-label / offloader-label fields in
 * the pair-build-server wizard), not a normalisation for
 * comparison.
 */
export function friendlyHostname(host: string): string {
  let s = trimTrailingDot(host.trim());
  if (s.toLowerCase().endsWith(".local")) {
    s = s.slice(0, -".local".length);
  }
  return s;
}

/**
 * Normalise a hostname for case-insensitive equality comparison.
 *
 * Trims surrounding whitespace, drops a trailing dot, lowercases.
 * The lowercase step is canonical per RFC 4343 (DNS labels
 * compare case-insensitively); the trailing-dot step bridges the
 * mDNS canonical-FQDN form against the user-typed dot-less form
 * so a "have I already paired with this host" check matches a
 * persisted ``mydashboard.local`` against a discovered
 * ``MyDashboard.local.``.
 *
 * Pair this with itself on both sides of an equality check; the
 * function is its own inverse for already-normalised inputs.
 */
export function normalizeHostnameForCompare(host: string): string {
  return trimTrailingDot(host.trim()).toLowerCase();
}
