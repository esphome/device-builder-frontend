/** CRC-32 as zlib computes it (reflected 0xEDB88320, init and final XOR of all ones). */
const TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  TABLE[n] = c >>> 0;
}

/**
 * The CRC of ``data``, continued from ``seed`` (the CRC of what came before
 * it, as ``zlib.crc32(data, seed)``), so a stream can be checked piecewise.
 */
export function crc32(data: Uint8Array, seed = 0): number {
  let crc = (seed ^ 0xffffffff) >>> 0;
  for (const byte of data) crc = TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
