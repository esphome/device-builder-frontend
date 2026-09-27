import { describe, expect, it } from "vitest";

import {
  crc16CcittItu,
  encodeSerialFrame,
} from "../../../src/platforms/nrf52/smp-serial.js";

const START_1 = 0x06;
const START_2 = 0x09;
const CONT_1 = 0x04;
const CONT_2 = 0x14;
const DELIM = 0x0a;

/** Decode one or more mcumgr serial lines back into the raw SMP frame. */
function decodeSerialLines(encoded: Uint8Array): Uint8Array {
  let b64 = "";
  let i = 0;
  while (i < encoded.length) {
    const m1 = encoded[i];
    const m2 = encoded[i + 1];
    expect([START_1, CONT_1]).toContain(m1);
    expect(m1 === START_1 ? START_2 : CONT_2).toBe(m2);
    i += 2;
    let line = "";
    while (i < encoded.length && encoded[i] !== DELIM) {
      line += String.fromCharCode(encoded[i]);
      i++;
    }
    i++; // skip the newline
    b64 += line;
  }
  const bin = atob(b64);
  const raw = new Uint8Array(bin.length);
  for (let j = 0; j < bin.length; j++) raw[j] = bin.charCodeAt(j);
  return raw;
}

describe("crc16CcittItu", () => {
  // CRC16/CCITT (XMODEM, poly 0x1021, init 0x0000) known vector.
  it("matches the known '123456789' vector (0x31C3)", () => {
    const data = new TextEncoder().encode("123456789");
    expect(crc16CcittItu(data)).toBe(0x31c3);
  });

  it("is 0 for empty input", () => {
    expect(crc16CcittItu(new Uint8Array(0))).toBe(0);
  });
});

describe("encodeSerialFrame", () => {
  it("wraps the frame as [len][data][crc], base64-encoded with the start marker", () => {
    const frame = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const encoded = encodeSerialFrame(frame);

    // Starts with the packet marker and ends with a newline.
    expect(encoded[0]).toBe(START_1);
    expect(encoded[1]).toBe(START_2);
    expect(encoded[encoded.length - 1]).toBe(DELIM);

    const raw = decodeSerialLines(encoded);
    // Length prefix (inside the base64 payload) = data + 2-byte CRC.
    const declaredLen = (raw[0] << 8) | raw[1];
    expect(declaredLen).toBe(frame.length + 2);

    // Body is the original frame followed by its CRC16.
    const data = raw.slice(2, 2 + frame.length);
    expect(Array.from(data)).toEqual(Array.from(frame));

    const crc = (raw[raw.length - 2] << 8) | raw[raw.length - 1];
    expect(crc).toBe(crc16CcittItu(frame));
  });

  it("splits a large frame into continuation lines", () => {
    const frame = new Uint8Array(600).map((_, i) => i & 0xff);
    const encoded = encodeSerialFrame(frame);

    // The first line carries the start marker; later lines the continuation one.
    expect(encoded[0]).toBe(START_1);
    let lineCount = 0;
    let sawContinuation = false;
    for (let i = 0; i < encoded.length; i++) {
      if (encoded[i] === DELIM) lineCount++;
    }
    // Scan line starts for a continuation marker.
    let atLineStart = true;
    for (let i = 0; i < encoded.length; i++) {
      if (atLineStart && encoded[i] === CONT_1 && encoded[i + 1] === CONT_2) {
        sawContinuation = true;
      }
      atLineStart = encoded[i] === DELIM;
    }
    expect(lineCount).toBeGreaterThan(1);
    expect(sawContinuation).toBe(true);

    // And it still round-trips to the original frame.
    const raw = decodeSerialLines(encoded);
    const data = raw.slice(2, 2 + frame.length);
    expect(Array.from(data)).toEqual(Array.from(frame));
  });
});
