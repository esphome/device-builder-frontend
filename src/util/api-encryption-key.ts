import { arrayBufferToBase64 } from "./base64.js";

/**
 * Generate a fresh ESPHome Native API encryption (Noise) key: 32 random
 * bytes, base64-encoded (a 44-char string). Mirrors the on-demand generator
 * in the API component docs — done client-side (`crypto.getRandomValues`) so
 * the editor needs no backend round-trip.
 */
export function generateApiEncryptionKey(): string {
  return arrayBufferToBase64(crypto.getRandomValues(new Uint8Array(32)).buffer);
}
