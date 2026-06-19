/** Origin of the ESPHome documentation site; build doc links from this. */
export const ESPHOME_DOCS_BASE = "https://esphome.io";

/**
 * Secure-context Web Serial flasher the dashboard hands firmware to over
 * postMessage (the HA add-on is plain http, so it can't run Web Serial itself).
 *
 * RELEASE GATE: this is the DEVELOPMENT target (GitHub Pages). It MUST be
 * flipped to web.esphome.io before any backend release bundles this frontend,
 * or HA add-on users would hand their factory image to a dev site. Tracked in
 * esphome/backlog#151; the companion web.esphome.io postMessage-ingest change
 * lands first. Until then PR #904 stays a draft (the actual merge gate).
 *
 * FLASHER_ORIGIN is the bare origin used for the postMessage targetOrigin and
 * for validating inbound frames.
 */
export const FLASHER_URL = "https://esphome.github.io/device-builder/";
// Derived so the postMessage targetOrigin / inbound-frame check can't drift
// from FLASHER_URL when the target moves to web.esphome.io.
export const FLASHER_ORIGIN = new URL(FLASHER_URL).origin;
