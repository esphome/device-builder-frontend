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

/** A Noise PSK is exactly 32 bytes, base64-encoded: 43 base64 chars + one `=`
 *  pad (32 mod 3 === 2). Matches what `generateApiEncryptionKey` emits and
 *  what the docs generator / backend `key` validator accept. */
const API_ENCRYPTION_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

/** Whether *value* is a well-formed 32-byte base64 API encryption key. */
export function isValidApiEncryptionKey(value: string): boolean {
  return API_ENCRYPTION_KEY_RE.test(value);
}

/**
 * Whether a structured-editor field is the `api:` → `encryption:` → `key:`
 * Noise PSK — the one field that wants format validation and a generate
 * affordance. The same path triplet is referenced by `SECURITY_SETTINGS.api`
 * (security-notice.ts) and `DEVICE_BASE.api.key` (secret-eligibility.ts).
 */
export function isApiEncryptionKeyField(
  sectionKey: string,
  path: readonly string[]
): boolean {
  return sectionKey === "api" && path.join(".") === "encryption.key";
}
