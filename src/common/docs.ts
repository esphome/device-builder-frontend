/** Origin of the ESPHome documentation site; build doc links from this. */
export const ESPHOME_DOCS_BASE = "https://esphome.io";

/**
 * Secure-context Web Serial flasher the dashboard hands firmware to over
 * postMessage (the HA add-on is plain http, so it can't run Web Serial itself).
 *
 * Production target: web.esphome.io. Its postMessage-ingest receiver is
 * esphome/dashboard#923, which MUST be merged and deployed before a backend
 * release bundles this frontend, or HA add-on users would hand their factory
 * image to a web.esphome.io that doesn't yet accept it. Tracked in
 * esphome/backlog#151.
 *
 * FLASHER_ORIGIN is the bare origin used for the postMessage targetOrigin and
 * for validating inbound frames.
 */
export const FLASHER_URL = "https://web.esphome.io/";
// Derived so the postMessage targetOrigin / inbound-frame check can't drift
// from FLASHER_URL when the target moves to web.esphome.io.
export const FLASHER_ORIGIN = new URL(FLASHER_URL).origin;
