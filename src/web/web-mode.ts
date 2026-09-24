/**
 * ESP ⇄ Pico ⇄ nRF mode, encoded in the URL query so a link is shareable and
 * a reload keeps the chosen device family (matching the legacy site's ``/?pico``
 * convention). ``esp`` is the default and carries no query param.
 */
export type WebMode = "esp" | "pico" | "nrf";

const PICO_PARAM = "pico";
const NRF_PARAM = "nrf";

/** Read the current mode from a query string (defaults to the live URL). */
export function readMode(search: string = window.location.search): WebMode {
  const params = new URLSearchParams(search);
  if (params.has(PICO_PARAM)) return "pico";
  if (params.has(NRF_PARAM)) return "nrf";
  return "esp";
}

/**
 * Build the mode path for a given mode, preserving any other query params
 * already present. Pure so it can be unit-tested and reused by the header's
 * link href.
 */
export function modeUrl(mode: WebMode, url: URL = new URL(window.location.href)): string {
  const next = new URL(url.toString());
  // Drop any existing mode params, then re-append the right one.
  next.searchParams.delete(PICO_PARAM);
  next.searchParams.delete(NRF_PARAM);
  let search = next.search;
  if (mode === "pico") {
    // Legacy site used a bare ``?pico`` (no ``=``).
    search = search ? `${search}&${PICO_PARAM}` : `?${PICO_PARAM}`;
  } else if (mode === "nrf") {
    search = search ? `${search}&${NRF_PARAM}` : `?${NRF_PARAM}`;
  }
  return next.pathname + search + next.hash;
}

/** Push a mode change into the address bar without a navigation/reload. */
export function writeMode(mode: WebMode): void {
  window.history.pushState(null, "", modeUrl(mode));
}
