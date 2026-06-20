/** Origin of the ESPHome documentation site; build doc links from this. */
export const ESPHOME_DOCS_BASE = "https://esphome.io";

/**
 * Secure-context Web Serial flasher the dashboard hands firmware to over
 * postMessage (the HA add-on is plain http, so it can't run Web Serial itself).
 *
 * web.esphome.io hosts the postMessage-ingest receiver the hand-off targets.
 *
 * FLASHER_ORIGIN is the bare origin used for the postMessage targetOrigin and
 * for validating inbound frames.
 */
export const FLASHER_URL = "https://web.esphome.io/";
// Derived so the postMessage targetOrigin / inbound-frame check can't drift
// from FLASHER_URL.
export const FLASHER_ORIGIN = new URL(FLASHER_URL).origin;
// The bare host (no scheme), for user-facing copy; same single source as above.
export const FLASHER_HOST = new URL(FLASHER_URL).host;
