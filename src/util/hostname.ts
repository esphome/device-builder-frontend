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

/**
 * Parse a user-typed port string into a valid 1-65535 integer.
 *
 * Returns ``null`` for any non-decimal content (whitespace
 * inside, trailing garbage, leading sign), zero, or
 * out-of-range values. ``Number.parseInt`` alone is
 * permissive — it stops at the first non-digit and accepts
 * leading whitespace + trailing garbage (``"6055abc"`` parses
 * to ``6055``); the regex pins the input shape before
 * parsing.
 *
 * Used by the pair-build-server wizard's input step and the
 * edit-pairing-endpoint dialog's Save gate; both want the
 * same "did the user type a valid port?" semantics keyed on
 * the same constraints. ``null`` semantics are invariant
 * across both: caller treats it as "Save disabled" /
 * "validation failed", non-null as "use this int as the wire
 * value." Mirrors the receiver-side ``_validate_port``'s
 * accepted range so a value that passes here is guaranteed
 * to round-trip through the WS validator without raising.
 */
/**
 * Split a pasted "host:6055" / "[fd00::1]:6055" into its parts.
 *
 * Null when there's no valid port suffix — a bare hostname, a bare
 * IPv6 literal (multiple colons, no brackets), or an out-of-range
 * port all stay whole.
 */
export function splitHostPort(value: string): { host: string; port: number } | null {
  const trimmed = value.trim();
  const match =
    /^\[([^\]]+)\]:(\d{1,5})$/.exec(trimmed) ?? /^([^:\s]+):(\d{1,5})$/.exec(trimmed);
  if (!match) return null;
  const port = parsePortInput(match[2]);
  return port === null ? null : { host: match[1], port };
}

export function parsePortInput(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return n;
}
