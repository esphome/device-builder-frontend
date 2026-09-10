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
 * Vendor stock firmware uses the short form heavily — Athom and
 * Apollo both ship ``github://…``. Showing only the raw shorthand in
 * the Take-Control dialog leaves the user without a way to actually
 * inspect what they're trusting; this helper resolves the shorthand
 * to a ``blob/<ref>/<file>`` URL the browser can render.
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
  service: "github" | "gitlab" | "codeberg" | null;
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
  // GitHub's ``blob/<ref>/<path>`` route renders a file with
  // syntax highlighting + commit history. Falls back to ``HEAD``
  // when the shorthand omitted ``@ref``.
  const refSegment = ref ?? "HEAD";

  if (domain === "github") {
    return {
      raw,
      browseUrl: `https://github.com/${owner}/${repo}/blob/${refSegment}/${filename}`,
      service: "github",
    };
  }
  if (domain === "gitlab") {
    return {
      raw,
      browseUrl: `https://gitlab.com/${owner}/${repo}/-/blob/${refSegment}/${filename}`,
      service: "gitlab",
    };
  }
  if (domain === "codeberg") {
    // Forgejo's browse routes are typed (``src/branch/<ref>``,
    // ``src/tag/<ref>``, ``src/commit/<sha>``) and the shorthand
    // doesn't say which kind of ref it carries - ``src/branch/<tag>``
    // 404s. The untyped ``src/<ref>/<path>`` route makes Forgejo
    // resolve the ref kind itself and redirect to the typed URL,
    // and ``src/HEAD/<path>`` redirects to the default branch, so
    // it also covers the ``HEAD`` fallback when ``@ref`` is omitted.
    return {
      raw,
      browseUrl: `https://codeberg.org/${owner}/${repo}/src/${refSegment}/${filename}`,
      service: "codeberg",
    };
  }

  // Recognised shorthand shape but unknown domain (e.g. a future
  // ``bitbucket://``). Don't fabricate a URL — fall back to
  // plain-text display. The user still sees the raw value;
  // they just don't get a click target until we add support.
  return { raw, browseUrl: null, service: null };
}
