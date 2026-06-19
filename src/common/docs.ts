/** Origin of the ESPHome documentation site; build doc links from this. */
export const ESPHOME_DOCS_BASE = "https://esphome.io";

/**
 * Secure-context Web Serial flasher the dashboard hands firmware to over
 * postMessage (the HA add-on is plain http, so it can't run Web Serial itself).
 * Development/testing target; this moves to web.esphome.io once that gains the
 * postMessage-ingest mode. FLASHER_ORIGIN is the bare origin used for the
 * postMessage targetOrigin and for validating inbound frames.
 */
export const FLASHER_URL = "https://esphome.github.io/device-builder/";
export const FLASHER_ORIGIN = "https://esphome.github.io";
