import type { ConfiguredDevice } from "../api/types/devices.js";

/**
 * Return *url* if it parses cleanly and uses ``http:`` or ``https:``;
 * empty string otherwise.
 *
 * Shared guard for any user-clickable link whose value comes from
 * device-side data (mDNS, YAML, etc.). Without it, a hostile
 * announcement could surface a ``javascript:`` URL that runs code
 * when the user clicks the resulting ``<a href>``. ``new URL``
 * rejects malformed input; the protocol check covers the rest.
 *
 * Userinfo is also rejected: ``http://device.local@evil.com`` parses
 * as a valid ``http:`` URL whose *host* is ``evil.com`` (the part
 * before ``@`` is a username), so it would slip past the protocol
 * check and send the user to an attacker-controlled origin while
 * looking like it points at the device. The same hostile-device-data
 * threat the protocol check defends against applies here, so any
 * ``@`` in the authority is treated as unsafe. We test the raw
 * authority rather than ``parsed.username``/``parsed.password``
 * because empty userinfo (``http://@evil.com`` / ``http://:@evil.com``)
 * parses with both empty yet still points ``host`` at the attacker.
 * Slicing the authority off the raw string keeps a legitimate ``@``
 * in a path/query/fragment from being rejected. The slice strips the
 * scheme via the parsed ``protocol`` (not a literal ``://``) and
 * collapses leading slashes/backslashes, so the abbreviated special-
 * scheme authority forms the WHATWG parser still accepts —
 * ``http:/user@evil.com``, ``http:user@evil.com``,
 * ``http:\\user@evil.com`` (all parse with host ``evil.com``) — are
 * caught too, not just the canonical ``http://…@…``.
 *
 * The string is returned with ASCII tab/CR/LF stripped and
 * leading/trailing C0 control characters and spaces trimmed (but
 * otherwise un-canonicalised, rather than ``parsed.toString()``) so
 * callers keep the terse form ``http://host:22`` instead of the
 * WHATWG-canonicalised ``http://host:22/``.
 *
 * One subtlety: the WHATWG URL parser silently strips ASCII tab, CR,
 * and LF from *anywhere* in the input and trims leading/trailing C0
 * control characters and spaces (U+0000–U+0020) *before* computing
 * ``parsed.protocol``, so ``ht\ntp://device.local@evil.com`` and
 * ``  http://device.local@evil.com`` both parse cleanly with host
 * ``evil.com``. If we sliced the authority off the *raw* string, those
 * stripped/trimmed characters would desync the raw scheme length from
 * ``parsed.protocol`` and the slice would read from the wrong offset —
 * missing the ``@`` and waving the spoof through. We therefore run the
 * authority check (and slice) against the same sanitized string the
 * parser saw, and return *that* sanitized form so the href a caller
 * renders can't smuggle the stripped chars back in.
 */
export function safeWebUiUrl(url: string): string {
  if (!url) return "";
  // Mirror the WHATWG parser, which trims leading/trailing C0
  // controls + spaces and removes ASCII tab/CR/LF everywhere, so our
  // raw-string authority slice lines up with what `new URL` saw.
  const cleaned = url
    .replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "")
    .replace(/[\t\r\n]/g, "");
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    const authority = cleaned
      .slice(parsed.protocol.length)
      .replace(/^[/\\]+/, "")
      .split(/[/?#\\]/, 1)[0];
    if (authority.includes("@")) return "";
    return cleaned;
  } catch {
    return "";
  }
}

/**
 * Wrap *host* in square brackets when it's a bare IPv6 literal so the
 * port suffix in a URL stays unambiguous (``http://[::1]:80`` rather
 * than ``http://::1:80``, which the URL parser reads as host ``::``
 * port ``1:80``). DNS hostnames can't contain ``:`` so the colon test
 * is a reliable IPv6 detector; already-bracketed input is returned
 * untouched so this can be called repeatedly without nesting.
 */
function _bracketIpv6(host: string): string {
  if (host.startsWith("[") || !host.includes(":")) return host;
  return `[${host}]`;
}

/**
 * Build the device's web-UI URL, or return ``""`` when the YAML didn't
 * expose a ``web_server`` port or we don't have a host to point at.
 *
 * Single source of truth for the dashboard's "Visit Web UI" affordance —
 * the table column, the device card, and the row-menu fallback all
 * share this so the host/port/protocol logic can't drift between
 * call sites. Returns empty string (not ``null``) so callers can
 * skip-render with a truthy check.
 */
export function buildWebUiUrl(device: ConfiguredDevice): string {
  if (device.web_port == null) return "";
  const host = device.address || device.ip;
  if (!host) return "";
  return safeWebUiUrl(
    `http://${_bracketIpv6(host)}${device.web_port === 80 ? "" : `:${device.web_port}`}`
  );
}
