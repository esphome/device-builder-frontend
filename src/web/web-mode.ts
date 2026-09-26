/**
 * The device family (``platforms/registry.ts``), encoded in the URL query so a
 * link is shareable and a reload keeps the chosen family (matching the legacy
 * site's ``/?pico`` convention). The default (ESP) carries no query param;
 * the others are a bare ``?<mode>`` flag.
 */
import { DEFAULT_WEB_MODE, WEB_PLATFORMS, type WebMode } from "./platforms/registry.js";

export type { WebMode };

// Every family but the default, in registry order (the first flag present wins).
const FLAGGED_MODES: readonly WebMode[] = WEB_PLATFORMS.map((p) => p.mode).filter(
  (mode) => mode !== DEFAULT_WEB_MODE
);

/** Read the current mode from a query string (defaults to the live URL). */
export function readMode(search: string = window.location.search): WebMode {
  const params = new URLSearchParams(search);
  return FLAGGED_MODES.find((mode) => params.has(mode)) ?? DEFAULT_WEB_MODE;
}

/**
 * Build the mode path for a given mode, preserving any other query params
 * already present. Pure so it can be unit-tested and reused by the header's
 * link href.
 */
export function modeUrl(mode: WebMode, url: URL = new URL(window.location.href)): string {
  const next = new URL(url.toString());
  // Re-append the flag bare (legacy ``?pico``); building by hand avoids the
  // URLSearchParams ``pico=`` spelling without touching other params' form.
  for (const flag of FLAGGED_MODES) next.searchParams.delete(flag);
  let search = next.search;
  if (mode !== DEFAULT_WEB_MODE) {
    search = search ? `${search}&${mode}` : `?${mode}`;
  }
  return next.pathname + search + next.hash;
}

/** Push a mode change into the address bar without a navigation/reload. */
export function writeMode(mode: WebMode): void {
  window.history.pushState(null, "", modeUrl(mode));
}
