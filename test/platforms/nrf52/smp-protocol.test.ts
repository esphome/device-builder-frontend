import { describe, expect, it } from "vitest";

import {
  buildSmpFrame,
  chunkSizeFromParams,
  IMG_MGMT_STATE,
  IMG_MGMT_UPLOAD,
  MGMT_GROUP_IMAGE,
  MGMT_GROUP_OS,
  MGMT_OP_READ,
  MGMT_OP_WRITE,
  OS_MGMT_MCUMGR_PARAMS,
  OS_MGMT_RESET,
  parseMcubootImageInfo,
  parseSmpFrame,
  smpQueryDeviceParams,
  type SmpTransport,
  smpUploadImage,
} from "../../../src/platforms/nrf52/smp-protocol.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal valid MCUboot image whose SHA256 TLV holds `hash`. */
function makeMcubootImage(
  hash: Uint8Array,
  { imgSize = 64, version = [1, 2, 3] as [number, number, number] } = {}
): Uint8Array {
  const hdrSize = 32;
  const tlvArea = 4 + 4 + 32; // info header + one TLV header + 32-byte hash
  const total = hdrSize + imgSize + tlvArea;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, 0x96f3b83d, true); // magic
  view.setUint32(4, 0, true); // load addr
  view.setUint16(8, hdrSize, true); // hdr size
  view.setUint16(10, 0, true); // protected TLV size
  view.setUint32(12, imgSize, true); // image size
  bytes[20] = version[0];
  bytes[21] = version[1];
  view.setUint16(22, version[2], true);

  const tlvOff = hdrSize + imgSize;
  view.setUint16(tlvOff, 0x6907, true); // unprotected TLV info magic
  view.setUint16(tlvOff + 2, tlvArea, true); // total TLV area size
  bytes[tlvOff + 4] = 0x10; // IMAGE_TLV_SHA256
  bytes[tlvOff + 5] = 0; // pad
  view.setUint16(tlvOff + 6, 32, true); // length
  bytes.set(hash, tlvOff + 8);

  return bytes;
}

interface ImageEntry {
  slot: number;
  hash: Uint8Array;
  active?: boolean;
  confirmed?: boolean;
}

/** A scripted SMP transport that answers image-management commands. */
class MockTransport implements SmpTransport {
  uploadChunks = 0;
  uploadedBytes = 0;
  confirmed = false;
  tested = false;
  reset = false;
  testHash?: Uint8Array;

  constructor(private readonly getImages: () => ImageEntry[]) {}

  async exchange(frame: Uint8Array): Promise<Uint8Array> {
    const req = parseSmpFrame(frame);
    const reply = (payload: Record<string, unknown>) =>
      buildSmpFrame(3, req.group, req.id, req.seq, payload);

    if (req.group === MGMT_GROUP_IMAGE && req.id === IMG_MGMT_STATE) {
      if (req.op === MGMT_OP_READ) return reply({ images: this.getImages() });
      if (req.payload.confirm === true) this.confirmed = true;
      else {
        this.tested = true;
        this.testHash = req.payload.hash as Uint8Array;
      }
      return reply({ rc: 0 });
    }
    if (req.group === MGMT_GROUP_IMAGE && req.id === IMG_MGMT_UPLOAD) {
      this.uploadChunks++;
      const data = req.payload.data as Uint8Array;
      const off = req.payload.off as number;
      this.uploadedBytes = off + data.length;
      return reply({ rc: 0, off: this.uploadedBytes });
    }
    if (req.group === MGMT_GROUP_OS && req.id === OS_MGMT_RESET) {
      this.reset = true;
      return reply({ rc: 0 });
    }
    return reply({ rc: 0 });
  }

  close(): void {}
}

const noHooks = { onProgress: () => {} };

// ── Frame building / parsing ───────────────────────────────────────────────

describe("buildSmpFrame / parseSmpFrame", () => {
  it("round-trips the header fields and payload", () => {
    const frame = buildSmpFrame(MGMT_OP_WRITE, MGMT_GROUP_IMAGE, IMG_MGMT_UPLOAD, 42, {
      off: 128,
    });
    const parsed = parseSmpFrame(frame);
    expect(parsed.op).toBe(MGMT_OP_WRITE);
    expect(parsed.group).toBe(MGMT_GROUP_IMAGE);
    expect(parsed.id).toBe(IMG_MGMT_UPLOAD);
    expect(parsed.seq).toBe(42);
    expect(parsed.payload).toEqual({ off: 128 });
  });

  it("encodes the payload length in the header", () => {
    const frame = buildSmpFrame(MGMT_OP_READ, MGMT_GROUP_OS, OS_MGMT_MCUMGR_PARAMS, 0);
    // No payload → length 0.
    expect((frame[2] << 8) | frame[3]).toBe(0);
    expect(frame.length).toBe(8);
  });

  it("throws on a truncated frame", () => {
    expect(() => parseSmpFrame(new Uint8Array(4))).toThrow();
  });
});

// ── MCUboot image parsing ──────────────────────────────────────────────────

describe("parseMcubootImageInfo", () => {
  it("extracts version and the SHA256 TLV hash", async () => {
    const hash = new Uint8Array(32).fill(0xab);
    const info = await parseMcubootImageInfo(
      makeMcubootImage(hash, { version: [1, 4, 7] })
    );
    expect(info.version).toBe("1.4.7");
    expect(info.imageHash).toBeInstanceOf(Uint8Array);
    expect(Array.from(info.imageHash!)).toEqual(Array.from(hash));
  });

  it("rejects a non-MCUboot binary", async () => {
    await expect(parseMcubootImageInfo(new Uint8Array(64))).rejects.toThrow(/magic/);
  });

  it("rejects a too-short binary", async () => {
    await expect(parseMcubootImageInfo(new Uint8Array(8))).rejects.toThrow();
  });
});

// ── Device-parameter negotiation ───────────────────────────────────────────

describe("smpQueryDeviceParams / chunkSizeFromParams", () => {
  it("parses buf_size and buf_count from the device", async () => {
    const transport: SmpTransport = {
      exchange: async (frame) => {
        const req = parseSmpFrame(frame);
        return buildSmpFrame(1, req.group, req.id, req.seq, {
          buf_size: 2475,
          buf_count: 4,
        });
      },
      close: () => {},
    };
    const params = await smpQueryDeviceParams(transport);
    expect(params).toEqual({ bufSize: 2475, bufCount: 4 });
  });

  it("returns null when the device does not support the command", async () => {
    const transport: SmpTransport = {
      exchange: async () => {
        throw new Error("not supported");
      },
      close: () => {},
    };
    expect(await smpQueryDeviceParams(transport)).toBeNull();
  });

  it("derives a chunk size bounded by buf_size, not a fixed cap", () => {
    // A large buffer yields a correspondingly large chunk (fewer round-trips).
    expect(chunkSizeFromParams({ bufSize: 2475, bufCount: 4 })).toBeGreaterThan(2000);
    // A tiny buffer never drops below the 64-byte floor.
    expect(chunkSizeFromParams({ bufSize: 40, bufCount: 1 })).toBe(64);
  });
});

// ── Upload orchestration ───────────────────────────────────────────────────

describe("smpUploadImage", () => {
  const hashActive = new Uint8Array(32).fill(0x11);
  const hashOldSlot1 = new Uint8Array(32).fill(0x22);

  it("skips the upload when the device is already running this image", async () => {
    const hash = new Uint8Array(32).fill(0x33);
    const image = makeMcubootImage(hash);
    const info = await parseMcubootImageInfo(image);
    const transport = new MockTransport(() => [
      { slot: 0, hash, active: true, confirmed: true },
      { slot: 1, hash: hashOldSlot1 },
    ]);

    await smpUploadImage(transport, image, info, 128, noHooks);

    expect(transport.uploadChunks).toBe(0);
    expect(transport.tested).toBe(false);
    expect(transport.reset).toBe(false);
  });

  it("skips the upload when the image is already in the update slot", async () => {
    const hash = new Uint8Array(32).fill(0x44);
    const image = makeMcubootImage(hash);
    const info = await parseMcubootImageInfo(image);
    const transport = new MockTransport(() => [
      { slot: 0, hash: hashActive, active: true, confirmed: true },
      { slot: 1, hash },
    ]);

    await smpUploadImage(transport, image, info, 128, noHooks);

    expect(transport.uploadChunks).toBe(0);
    expect(transport.tested).toBe(true);
    expect(transport.reset).toBe(true);
  });

  it("confirms an unconfirmed running image before proceeding", async () => {
    // Running image is this exact image but unconfirmed → confirm, then it's
    // already-running so no upload is needed.
    const hash = new Uint8Array(32).fill(0x55);
    const image = makeMcubootImage(hash);
    const info = await parseMcubootImageInfo(image);
    const transport = new MockTransport(() => [
      { slot: 0, hash, active: true, confirmed: false },
      { slot: 1, hash: hashOldSlot1, confirmed: true },
    ]);

    await smpUploadImage(transport, image, info, 128, noHooks);

    expect(transport.confirmed).toBe(true);
    expect(transport.uploadChunks).toBe(0);
  });

  it("uploads, marks for test, and resets for a new image", async () => {
    const hash = new Uint8Array(32).fill(0x66);
    const image = makeMcubootImage(hash, { imgSize: 512 });
    const info = await parseMcubootImageInfo(image);
    const transport: MockTransport = new MockTransport(() => [
      { slot: 0, hash: hashActive, active: true, confirmed: true },
      // Slot 1 holds the uploaded image only once the transfer finishes.
      { slot: 1, hash: transport.uploadedBytes >= image.length ? hash : hashOldSlot1 },
    ]);

    const percents: number[] = [];
    await smpUploadImage(transport, image, info, 128, {
      onProgress: (p) => percents.push(p),
    });

    expect(transport.uploadChunks).toBeGreaterThan(0);
    expect(transport.uploadedBytes).toBe(image.length);
    expect(transport.tested).toBe(true);
    expect(Array.from(transport.testHash!)).toEqual(Array.from(hash));
    expect(transport.reset).toBe(true);
    expect(percents[percents.length - 1]).toBe(100);
  });

  it("throws when the device reports an error mid-upload", async () => {
    const hash = new Uint8Array(32).fill(0x77);
    const image = makeMcubootImage(hash, { imgSize: 256 });
    const info = await parseMcubootImageInfo(image);
    const transport = new MockTransport(() => [
      { slot: 0, hash: hashActive, active: true, confirmed: true },
      { slot: 1, hash: hashOldSlot1 },
    ]);
    // Fail the first upload chunk with EBADSTATE (6).
    transport.exchange = async (frame) => {
      const req = parseSmpFrame(frame);
      if (req.group === MGMT_GROUP_IMAGE && req.id === IMG_MGMT_UPLOAD) {
        return buildSmpFrame(3, req.group, req.id, req.seq, { rc: 6 });
      }
      return buildSmpFrame(3, req.group, req.id, req.seq, {
        images: [
          { slot: 0, hash: hashActive, active: true, confirmed: true },
          { slot: 1, hash: hashOldSlot1 },
        ],
      });
    };

    await expect(smpUploadImage(transport, image, info, 128, noHooks)).rejects.toThrow(
      /error 6/
    );
  });
});
