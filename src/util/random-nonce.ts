/**
 * An unguessable one-time token for a postMessage hand-off.
 *
 * `crypto.randomUUID()` is `[SecureContext]`-gated and undefined on plain-http
 * origins, which is exactly where these hand-offs run (the HA add-on).
 * `getRandomValues` isn't gated, and the nonce only needs to be unguessable,
 * not a UUID.
 *
 * Shared by the flasher and stack-trace-decoder hand-offs, whose pages check it
 * against the value in their URL hash.
 */
export function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
