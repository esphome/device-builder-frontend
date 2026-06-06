/** Base64-encode an ArrayBuffer.
 *
 * Chunks the byte-to-char mapping so a multi-megabyte bundle doesn't blow
 * the argument limit of String.fromCharCode(...spread), and joins the
 * chunks once at the end rather than concatenating per chunk (which would
 * be quadratic for large buffers).
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(chunks.join(""));
}
