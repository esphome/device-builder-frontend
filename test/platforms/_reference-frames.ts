/**
 * Frames as the ``fixtures/record.py`` recorders write them down, for the
 * tests that hold an engine to a recorded transcript. ``summarise`` and
 * ``merged`` have to match the recorders' rules byte for byte.
 */

/** A frame on the wire: who sent it and what. */
export interface WireFrame {
  dir: "tx" | "rx";
  bytes: Uint8Array;
}

/** A frame as a recorder writes it down. */
export interface RecordedFrame {
  dir: string;
  length: number;
  hex?: string;
  head?: string;
  sha256?: string;
}

export const hex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export const sha256 = async (bytes: Uint8Array): Promise<string> =>
  hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))));

/** Whole up to 48 bytes, else by its 16 byte head and its hash. */
export async function summarise({ dir, bytes }: WireFrame): Promise<RecordedFrame> {
  return bytes.length <= 48
    ? { dir, length: bytes.length, hex: hex(bytes) }
    : {
        dir,
        length: bytes.length,
        head: hex(bytes.subarray(0, 16)),
        sha256: await sha256(bytes),
      };
}

/** Consecutive frames one way as one: how the bytes were split up says nothing. */
export function merged(frames: readonly WireFrame[]): WireFrame[] {
  const out: WireFrame[] = [];
  for (const frame of frames) {
    const last = out[out.length - 1];
    if (last?.dir === frame.dir) {
      const bytes = new Uint8Array(last.bytes.length + frame.bytes.length);
      bytes.set(last.bytes);
      bytes.set(frame.bytes, last.bytes.length);
      out[out.length - 1] = { dir: frame.dir, bytes };
    } else out.push(frame);
  }
  return out;
}
