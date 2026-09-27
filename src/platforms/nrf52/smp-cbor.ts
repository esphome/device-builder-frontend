/**
 * The subset of CBOR the SMP image commands use. Based on the MIT-licensed
 * cbor.js by Patrick Gansterer <paroga@paroga.com>.
 */

function writeTypeLen(type: number, len: number, out: number[]): void {
  if (len < 24) {
    out.push((type << 5) | len);
  } else if (len < 0x100) {
    out.push((type << 5) | 24, len);
  } else if (len < 0x10000) {
    out.push((type << 5) | 25, (len >>> 8) & 0xff, len & 0xff);
  } else {
    out.push(
      (type << 5) | 26,
      (len >>> 24) & 0xff,
      (len >>> 16) & 0xff,
      (len >>> 8) & 0xff,
      len & 0xff
    );
  }
}

function encodeItem(value: unknown, out: number[]): void {
  if (value === null) {
    out.push(0xf6);
    return;
  }
  if (value === true) {
    out.push(0xf5);
    return;
  }
  if (value === false) {
    out.push(0xf4);
    return;
  }
  if (value instanceof Uint8Array) {
    writeTypeLen(2, value.length, out);
    for (const b of value) out.push(b);
    return;
  }
  switch (typeof value) {
    case "number":
      if (Number.isInteger(value) && value >= 0) {
        writeTypeLen(0, value, out);
      } else if (Number.isInteger(value) && value < 0) {
        writeTypeLen(1, -1 - value, out);
      } else {
        out.push(0xfb);
        const buf = new ArrayBuffer(8);
        new DataView(buf).setFloat64(0, value);
        for (const b of new Uint8Array(buf)) out.push(b);
      }
      return;
    case "string": {
      const encoded = new TextEncoder().encode(value);
      writeTypeLen(3, encoded.length, out);
      for (const b of encoded) out.push(b);
      return;
    }
    default:
      if (Array.isArray(value)) {
        writeTypeLen(4, value.length, out);
        for (const item of value) encodeItem(item, out);
      } else if (typeof value === "object") {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj);
        writeTypeLen(5, keys.length, out);
        for (const k of keys) {
          encodeItem(k, out);
          encodeItem(obj[k], out);
        }
      }
  }
}

export function cborEncode(value: unknown): Uint8Array {
  const out: number[] = [];
  encodeItem(value, out);
  return new Uint8Array(out);
}

// Sentinel returned by decodeItem when it reads a CBOR "break" (0xff).
const BREAK = Symbol("cbor-break");

export function cborDecode(data: Uint8Array): unknown {
  let offset = 0;

  // A truncated reply would otherwise decode as NaN and undefined.
  function need(bytes: number): void {
    if (offset + bytes > data.length) throw new Error("CBOR: truncated input");
  }

  function readLen(info: number): number {
    if (info < 24) return info;
    need(info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : 8);
    if (info === 24) return data[offset++];
    if (info === 25) {
      const v = (data[offset] << 8) | data[offset + 1];
      offset += 2;
      return v;
    }
    if (info === 26) {
      const v =
        ((data[offset] << 24) |
          (data[offset + 1] << 16) |
          (data[offset + 2] << 8) |
          data[offset + 3]) >>>
        0;
      offset += 4;
      return v;
    }
    if (info === 27) {
      const hi =
        ((data[offset] << 24) |
          (data[offset + 1] << 16) |
          (data[offset + 2] << 8) |
          data[offset + 3]) >>>
        0;
      const lo =
        ((data[offset + 4] << 24) |
          (data[offset + 5] << 16) |
          (data[offset + 6] << 8) |
          data[offset + 7]) >>>
        0;
      offset += 8;
      return hi * 0x100000000 + lo;
    }
    throw new Error("CBOR: unsupported length encoding");
  }

  function decodeItem(): unknown | typeof BREAK {
    need(1);
    const initial = data[offset++];
    const major = initial >> 5;
    const info = initial & 0x1f;

    if (major === 7) {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      if (info === 31) return BREAK; // break code for indefinite-length items
      // Floats are skipped; no SMP response carries one.
      const floatBytes = info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0;
      if (floatBytes) {
        need(floatBytes);
        offset += floatBytes;
        return 0;
      }
      throw new Error(`CBOR: unsupported simple value ${info}`);
    }

    // An indefinite-length array (0x9f) or map (0xbf) runs until a break.
    if (info === 31) {
      if (major === 4) {
        const arr: unknown[] = [];
        for (;;) {
          const item = decodeItem();
          if (item === BREAK) break;
          arr.push(item);
        }
        return arr;
      }
      if (major === 5) {
        const obj: Record<string, unknown> = {};
        for (;;) {
          const key = decodeItem();
          if (key === BREAK) break;
          obj[key as string] = decodeItem();
        }
        return obj;
      }
      throw new Error(`CBOR: unsupported indefinite length for major ${major}`);
    }

    const len = readLen(info);

    switch (major) {
      case 0:
        return len;
      case 1:
        return -1 - len;
      case 2: {
        need(len);
        const slice = data.slice(offset, offset + len);
        offset += len;
        return slice;
      }
      case 3: {
        need(len);
        const slice = data.slice(offset, offset + len);
        offset += len;
        return new TextDecoder().decode(slice);
      }
      case 4: {
        const arr: unknown[] = [];
        for (let i = 0; i < len; i++) arr.push(decodeItem());
        return arr;
      }
      case 5: {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < len; i++) {
          const key = decodeItem() as string;
          obj[key] = decodeItem();
        }
        return obj;
      }
      default:
        throw new Error(`CBOR: unsupported major type ${major}`);
    }
  }

  return decodeItem();
}
