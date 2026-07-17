/** Origin of the ESPHome documentation site; build doc links from this. */
export const ESPHOME_DOCS_BASE = "https://esphome.io";

// Derived so the allowlist host can't drift from the base URL (same
// single-source shape as FLASHER_ORIGIN / FLASHER_HOST below).
export const ESPHOME_DOCS_HOST = new URL(ESPHOME_DOCS_BASE).hostname;

/**
 * Whitelist a docs URL to ``https://esphome.io``.
 *
 * Backend-populated maps and raw log text both feed rendered anchors; a
 * ``javascript:`` / ``data:`` scheme would run code on click, so bound every
 * link to the canonical host before rendering it.
 */
export function isSafeDocsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === ESPHOME_DOCS_HOST;
  } catch {
    return false;
  }
}

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

/**
 * Hosted crash-backtrace decoder, framed and handed an ELF over postMessage.
 *
 * Exists because a remote-built device has no CMake build tree locally, and
 * native ESP-IDF resolves addr2line only through that tree's cache, so the
 * backend can't decode it. The page runs esp-stacktrace-decoder's wasm and is
 * served with a CSP that permits no network egress, so the firmware stays in
 * the browser.
 *
 * Optional by design: unreachable (offline, GitHub down) means no decode, never
 * a broken log. If this URL moves, the old host has to keep serving until the
 * dashboards that shipped with it baked in have aged out.
 */
export const DECODER_URL =
  "https://esphome.github.io/device-builder/esp-stacktrace-decoder/";
// Derived so the postMessage targetOrigin / inbound-frame check can't drift
// from DECODER_URL.
export const DECODER_ORIGIN = new URL(DECODER_URL).origin;
