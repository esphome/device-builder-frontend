/**
 * ESP ⇄ Pico ⇄ nRF mode, encoded in the URL query so a link is shareable and
 * a reload keeps the chosen device family (matching the legacy site's ``/?pico``
 * convention). ``esp`` is the default and carries no query param; other modes
 * are a bare ``?<mode>`` flag.
 */
export type WebMode = "esp" | "pico" | "nrf";

const DEFAULT_MODE: WebMode = "esp";
const FLAGGED_MODES: readonly Exclude<WebMode, typeof DEFAULT_MODE>[] = ["pico", "nrf"];

/** Read the current mode from a query string (defaults to the live URL). */
export function readMode(search: string = window.location.search): WebMode {
  const params = new URLSearchParams(search);
  return FLAGGED_MODES.find((mode) => params.has(mode)) ?? DEFAULT_MODE;
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
  if (mode !== DEFAULT_MODE) {
    search = search ? `${search}&${mode}` : `?${mode}`;
  }
  return next.pathname + search + next.hash;
}

/** Push a mode change into the address bar without a navigation/reload. */
export function writeMode(mode: WebMode): void {
  window.history.pushState(null, "", modeUrl(mode));
}
