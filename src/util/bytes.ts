/** Little-endian u32 as four bytes. */
export function int32LE(v: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
}

/** Little-endian u24 as three bytes: a flash offset as the Realtek ROMs take it. */
export function int24LE(v: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff]);
}

/** Lower-case hex, two digits per byte, ``sep`` between them. */
export function toHex(bytes: Uint8Array, sep = ""): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(sep);
}

export function concat(...arrays: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(arrays.reduce((s, a) => s + a.length, 0));
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

/** Same length and bytes; false when either is missing. */
export function bytesEqual(
  a: Uint8Array | undefined,
  b: Uint8Array | undefined
): boolean {
  return (
    a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every((v, i) => v === b[i])
  );
}
