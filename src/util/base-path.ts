/**
 * URL path prefix where this app is mounted, with a trailing slash.
 * "/" for a standalone deployment, "/api/hassio_ingress/<token>/"
 * under HA ingress, "/some/prefix/" behind a reverse proxy.
 *
 * Derived from the entry script's URL — rspack's ``publicPath:
 * "auto"`` resolves chunk paths from ``document.currentScript.src``
 * at runtime, and we use the same source so client-side routing,
 * the WebSocket URL, and hard-coded asset references all line up
 * with the path the bundle was actually served from. Capturing this
 * before any ``pushState`` runs is what makes deep links work — once
 * the SPA navigates, ``window.location.pathname`` no longer reflects
 * the deployment base.
 */
const BASE_PATH: string = ((): string => {
  // Node test environments (vitest with the default Node pool) have
  // neither ``document`` nor ``window`` — guard so importing this
  // module doesn't crash before any test body runs.
  if (typeof document !== "undefined") {
    const script = document.currentScript;
    if (script instanceof HTMLScriptElement && script.src) {
      try {
        return new URL(script.src).pathname.replace(/[^/]*$/, "") || "/";
      } catch {
        // Fall through to the location-based fallback.
      }
    }
  }
  if (typeof window !== "undefined") {
    const path = window.location.pathname;
    return (path.endsWith("/") ? path : path.replace(/[^/]*$/, "")) || "/";
  }
  return "/";
})();

const BASE_NO_TRAIL = BASE_PATH === "/" ? "" : BASE_PATH.replace(/\/$/, "");

export { BASE_PATH };

/** Prefix an absolute path with the deployment base. Relative paths pass through unchanged. */
export function withBase(path: string): string {
  if (!path.startsWith("/")) return path;
  return BASE_NO_TRAIL + path;
}

/** Strip the deployment base from a pathname. Returns "/" when the pathname equals the base. */
export function stripBase(pathname: string): string {
  if (BASE_NO_TRAIL === "") return pathname;
  // Require a path-segment boundary after the prefix so a base of
  // "/foo" doesn't strip from "/foobar/...". The two valid forms
  // are pathname === BASE_NO_TRAIL ("/foo") or pathname starts
  // with BASE_PATH (the trailing-slash form, "/foo/...").
  if (pathname === BASE_NO_TRAIL) return "/";
  if (pathname.startsWith(BASE_PATH)) {
    return pathname.slice(BASE_NO_TRAIL.length) || "/";
  }
  return pathname;
}
