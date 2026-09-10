/**
 * Convert an ESPHome ``package_import_url`` to a browser-clickable URL.
 *
 * The dashboard's adoption flow forwards the device's advertised
 * ``package_import_url`` to ``esphome.dashboard_import.import_config``,
 * which routes the value through ``git.GitFile.from_shorthand`` and
 * rejects anything that isn't one of:
 *
 *   * ``github://owner/repo/path/file.yaml[@ref][?query]``
 *   * ``gitlab://owner/repo/path/file.yaml[@ref][?query]``
 *   * ``codeberg://owner/repo/path/file.yaml[@ref][?query]``
 *
 * (Source: ``esphome/git.py:from_shorthand`` + ``GIT_DOMAINS`` —
 * keep this util's regex in lockstep with upstream.)
 *
 * Vendor stock firmware uses the short form heavily; Athom and
 * Apollo both ship github:// URLs. Showing only the raw shorthand in
 * the Take-Control dialog leaves the user without a way to actually
 * inspect what they're trusting; this helper resolves the shorthand
 * to a file-browse URL the browser can render (blob/<ref>/<file> on
 * GitHub and GitLab, src/<ref>/<file> on Codeberg).
 *
 * Returns ``browseUrl: null`` when the raw value isn't a recognised
 * shorthand — caller falls back to plain-text display rather than
 * rendering an unsafe link. Defense in depth: a malicious mDNS
 * broadcast could put anything in the TXT field; we only follow
 * domains we know.
 */

/**
 * Mirrors the upstream shorthand grammar in ``esphome/git.py:289``.
 * Anchored at start-of-string (``^``) and end (``$``) so a trailing
 * fragment like ``foo://bar/baz/x.yaml javascript:`` doesn't sneak
 * through. The character classes match upstream verbatim.
 */
const SHORTHAND_RE =
  /^(?<domain>[a-zA-Z0-9-]+):\/\/(?<owner>[a-zA-Z0-9-]+)\/(?<repo>[a-zA-Z0-9\-_.]+)\/(?<filename>[a-zA-Z0-9\-_./]+?)(?:@(?<ref>[a-zA-Z0-9\-_./]+))?(?:\?(?<query>[a-zA-Z0-9\-_./]+))?$/;

type BrowseUrlBuilder = (parts: {
  owner: string;
  repo: string;
  ref: string;
  filename: string;
}) => string;

/**
 * Browse-URL template per shorthand domain. The key set is the list
 * of hosts we resolve; PackageImportService derives from it, so a new
 * host is one entry here plus a test.
 */
const BROWSE_URL_BUILDERS = {
  github: ({ owner, repo, ref, filename }) =>
    `https://github.com/${owner}/${repo}/blob/${ref}/${filename}`,
  gitlab: ({ owner, repo, ref, filename }) =>
    `https://gitlab.com/${owner}/${repo}/-/blob/${ref}/${filename}`,
  // Forgejo's browse routes are typed (src/branch/<ref>, src/tag/<ref>,
  // src/commit/<sha>) and the shorthand doesn't say which kind of ref
  // it carries; src/branch/<tag> 404s. The untyped src/<ref>/<path>
  // route makes Forgejo resolve the ref kind itself and redirect to
  // the typed URL, and src/HEAD/<path> redirects to the default
  // branch, so it also covers the HEAD fallback when @ref is omitted.
  codeberg: ({ owner, repo, ref, filename }) =>
    `https://codeberg.org/${owner}/${repo}/src/${ref}/${filename}`,
} as const satisfies Record<string, BrowseUrlBuilder>;

export type PackageImportService = keyof typeof BROWSE_URL_BUILDERS;

/**
 * An own-property check rather than the in operator: the shorthand
 * grammar admits domains such as constructor or toString, which the
 * in operator would find on the object prototype and hand back a
 * function that is not a URL builder.
 */
function isKnownService(domain: string): domain is PackageImportService {
  return Object.prototype.hasOwnProperty.call(BROWSE_URL_BUILDERS, domain);
}

export interface PackageImportUrlPreview {
  /** The original URL as the device advertised it. Always shown
   *  to the user verbatim; the converted ``browseUrl`` only adds
   *  the click target. */
  raw: string;
  /** A browser-friendly URL the user can click, or ``null`` when
   *  the raw URL isn't a recognised shorthand. */
  browseUrl: string | null;
  /** Service the URL points at, when known. Intended for a small
   *  badge ("GitHub", "GitLab", "Codeberg") next to the URL; no
   *  consumer renders one yet. ``null`` for unrecognised
   *  shorthands. */
  service: PackageImportService | null;
}

export function previewPackageImportUrl(
  raw: string | null | undefined
): PackageImportUrlPreview {
  if (!raw) {
    return { raw: "", browseUrl: null, service: null };
  }

  const match = SHORTHAND_RE.exec(raw);
  if (!match?.groups) {
    return { raw, browseUrl: null, service: null };
  }

  const { domain, owner, repo, filename, ref } = match.groups;
  // Falls back to HEAD when the shorthand omits @ref; every host's
  // browse route resolves HEAD to the default branch.
  const refSegment = ref ?? "HEAD";

  if (isKnownService(domain)) {
    return {
      raw,
      browseUrl: BROWSE_URL_BUILDERS[domain]({
        owner,
        repo,
        ref: refSegment,
        filename,
      }),
      service: domain,
    };
  }

  // Recognised shorthand shape but unknown domain (e.g. a future
  // ``bitbucket://``). Don't fabricate a URL — fall back to
  // plain-text display. The user still sees the raw value;
  // they just don't get a click target until we add support.
  return { raw, browseUrl: null, service: null };
}
