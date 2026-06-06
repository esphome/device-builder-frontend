/** Base64-encode an ArrayBuffer.
 *
 * Chunks the byte-to-char mapping so a multi-megabyte bundle doesn't blow
 * the argument limit of String.fromCharCode(...spread).
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
