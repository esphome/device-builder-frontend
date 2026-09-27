import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSmpFrame,
  chunkSizeFromParams,
  IMG_MGMT_STATE,
  IMG_MGMT_UPLOAD,
  type McubootImage,
  MGMT_GROUP_IMAGE,
  MGMT_GROUP_OS,
  OS_MGMT_MCUMGR_PARAMS,
  OS_MGMT_RESET,
  parseMcubootImage,
  parseSmpFrame,
  SmpNoReplyError,
  smpQueryDeviceParams,
  type SmpTransport,
  smpUploadImage,
} from "../../../src/platforms/nrf52/smp-protocol.js";
import { FakeSmpDevice, RUNNING } from "./_fake-smp-device.js";
import { makeMcubootImage } from "./_mcuboot-image.js";

async function upload(
  device: SmpTransport,
  image: McubootImage,
  { chunkSize = 128, signal }: { chunkSize?: number; signal?: AbortSignal } = {}
) {
  const progress: number[] = [];
  const log: string[] = [];
  const done = smpUploadImage(device, image, chunkSize, {
    onProgress: (p) => progress.push(p),
    onLog: (line) => log.push(line),
    signal,
  });
  done.catch(() => {});
  await vi.runAllTimersAsync();
  return { done, progress, log };
}

describe("smp frames", () => {
  it("round-trips a request", () => {
    const frame = buildSmpFrame(2, MGMT_GROUP_IMAGE, IMG_MGMT_UPLOAD, 7, { off: 12 });
    expect(parseSmpFrame(frame)).toEqual({
      op: 2,
      group: MGMT_GROUP_IMAGE,
      id: IMG_MGMT_UPLOAD,
      seq: 7,
      payload: { off: 12 },
    });
  });

  it("puts the payload length in the header", () => {
    const frame = buildSmpFrame(2, MGMT_GROUP_IMAGE, IMG_MGMT_UPLOAD, 0, { off: 12 });
    expect((frame[2] << 8) | frame[3]).toBe(frame.length - 8);
  });

  it("wraps the sequence number to one byte", () => {
    expect(parseSmpFrame(buildSmpFrame(0, 0, 0, 257)).seq).toBe(1);
  });

  it("rejects a frame shorter than its header", () => {
    expect(() => parseSmpFrame(new Uint8Array(7))).toThrow("SMP: frame too short");
  });
});

describe("parseMcubootImage", () => {
  it("reads the version, size and image hash", async () => {
    const hash = new Uint8Array(32).fill(0x42);
    const bytes = makeMcubootImage({
      bodySize: 64,
      version: [2, 5, 300],
      imageHash: hash,
    });
    const image = await parseMcubootImage(bytes);
    expect(image.bytes).toBe(bytes);
    expect(image.info.version).toBe("2.5.300");
    expect(image.info.imageSize).toBe(64);
    expect(image.info.imageHash).toEqual(hash);
    expect(image.info.hash).toHaveLength(32);
  });

  it("finds the hash past a protected TLV area", async () => {
    const hash = new Uint8Array(32).fill(0x42);
    const image = await parseMcubootImage(
      makeMcubootImage({ imageHash: hash, protectedTlvSize: 16 })
    );
    expect(image.info.imageHash).toEqual(hash);
  });

  it("leaves the image hash out when there is no TLV area", async () => {
    const image = await parseMcubootImage(makeMcubootImage({ imageHash: null }));
    expect(image.info.imageHash).toBeUndefined();
  });

  it.each([
    ["too short", new Uint8Array(16), "too short"],
    ["a bad magic", makeMcubootImage({ magic: 0xdeadbeef }), "bad magic"],
    [
      "a load address",
      makeMcubootImage({ loadAddress: 0x1000 }),
      "non-zero load address",
    ],
    ["its end cut off", makeMcubootImage({ imageHash: null }).slice(0, 200), "truncated"],
  ])("rejects an image with %s", async (_name, bytes, message) => {
    await expect(parseMcubootImage(bytes)).rejects.toThrow(message);
  });
});

describe("device parameters", () => {
  it("reads the device's buffer size", async () => {
    const transport: SmpTransport = {
      exchange: async (frame) => {
        const req = parseSmpFrame(frame);
        expect([req.group, req.id]).toEqual([MGMT_GROUP_OS, OS_MGMT_MCUMGR_PARAMS]);
        return buildSmpFrame(1, req.group, req.id, req.seq, {
          buf_size: 2475,
          buf_count: 4,
        });
      },
    };
    expect(await smpQueryDeviceParams(transport)).toEqual({ bufSize: 2475, bufCount: 4 });
  });

  it.each([
    ["stays silent", () => Promise.reject(new SmpNoReplyError("timeout"))],
    ["answers without them", () => Promise.resolve(buildSmpFrame(1, 0, 6, 0, { rc: 8 }))],
  ])("is null when the device %s", async (_name, exchange) => {
    expect(await smpQueryDeviceParams({ exchange })).toBeNull();
  });

  it("passes a failed write on instead of falling back", async () => {
    const exchange = () => Promise.reject(new Error("write failed"));
    await expect(smpQueryDeviceParams({ exchange })).rejects.toThrow("write failed");
  });

  it("passes a cancel on instead of falling back", async () => {
    const abort = new AbortController();
    abort.abort(new Error("cancelled"));
    const exchange = () => Promise.reject(new Error("cancelled"));

    await expect(smpQueryDeviceParams({ exchange }, abort.signal)).rejects.toThrow(
      "cancelled"
    );
  });

  it("leaves room for the first chunk's header and fields", () => {
    expect(chunkSizeFromParams({ bufSize: 2475, bufCount: 4 })).toBe(2475 - 8 - 70);
    expect(chunkSizeFromParams({ bufSize: 100, bufCount: 1 })).toBe(64);
  });
});

describe("smpUploadImage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uploads in chunks, marks the image for test and resets", async () => {
    const image = await parseMcubootImage(makeMcubootImage({ bodySize: 300 }));
    const device = new FakeSmpDevice();

    const { done, progress } = await upload(device, image, { chunkSize: 128 });
    await done;

    expect(device.received).toEqual(image.bytes);
    const chunks = device.requests.filter((r) => r.id === IMG_MGMT_UPLOAD);
    expect(chunks).toHaveLength(Math.ceil(image.bytes.length / 128));
    expect(chunks[0].payload).toMatchObject({
      off: 0,
      len: image.bytes.length,
      sha: image.info.hash,
    });
    expect(chunks[1].payload).not.toHaveProperty("sha");
    const tail = device.requests.slice(-2);
    expect(tail[0]).toMatchObject({
      id: IMG_MGMT_STATE,
      payload: { hash: device.uploadedHash, confirm: false },
    });
    expect(tail[1]).toMatchObject({ group: MGMT_GROUP_OS, id: OS_MGMT_RESET });
    expect(progress[progress.length - 1]).toBe(100);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it("finishes when the reset drops the link before its reply", async () => {
    const image = await parseMcubootImage(makeMcubootImage());
    const device = new FakeSmpDevice();
    device.resetDropsLink = true;

    const { done, progress } = await upload(device, image);

    await expect(done).resolves.toBeUndefined();
    expect(progress[progress.length - 1]).toBe(100);
  });

  it("fails when the reset request never went out", async () => {
    const image = await parseMcubootImage(makeMcubootImage());
    const device = new FakeSmpDevice();
    device.resetWriteFails = true;

    const { done, progress } = await upload(device, image);

    await expect(done).rejects.toThrow("write failed");
    expect(progress).not.toContain(100);
  });

  it("fails when the device refuses the reset", async () => {
    const image = await parseMcubootImage(makeMcubootImage());
    const device = new FakeSmpDevice();
    device.resetReply = { rc: 8 };

    const { done, progress } = await upload(device, image);

    await expect(done).rejects.toThrow("resetting failed (rc=8)");
    expect(progress).not.toContain(100);
  });

  it("fails when the update slot holds another image after the upload", async () => {
    const image = await parseMcubootImage(makeMcubootImage());
    const device = new FakeSmpDevice();
    device.uploadedHash = new Uint8Array(32).fill(0x99);

    const { done } = await upload(device, image);

    await expect(done).rejects.toThrow("update slot holds a different image");
    expect(device.requests.some((r) => r.id === OS_MGMT_RESET)).toBe(false);
  });

  it("sends nothing to a device already running the image", async () => {
    const image = await parseMcubootImage(makeMcubootImage({ imageHash: RUNNING }));
    const device = new FakeSmpDevice();

    const { done, progress } = await upload(device, image);
    await done;

    expect(device.ids()).toEqual([`${MGMT_GROUP_IMAGE}/${IMG_MGMT_STATE}`]);
    expect(progress).toEqual([100]);
  });

  it("skips the transfer when the update slot already holds the image", async () => {
    const hash = new Uint8Array(32).fill(0x77);
    const image = await parseMcubootImage(makeMcubootImage({ imageHash: hash }));
    const device = new FakeSmpDevice();
    device.slots.push({ slot: 1, hash });

    const { done } = await upload(device, image);
    await done;

    expect(device.requests.some((r) => r.id === IMG_MGMT_UPLOAD)).toBe(false);
    expect(device.requests[device.requests.length - 2]).toMatchObject({
      payload: { hash, confirm: false },
    });
    expect(device.requests[device.requests.length - 1]).toMatchObject({
      id: OS_MGMT_RESET,
    });
  });

  it("confirms an unconfirmed running image before uploading", async () => {
    const image = await parseMcubootImage(makeMcubootImage());
    const device = new FakeSmpDevice();
    device.slots[0].confirmed = false;

    const { done } = await upload(device, image);
    await done;

    expect(device.requests[1]).toMatchObject({
      id: IMG_MGMT_STATE,
      payload: { hash: RUNNING, confirm: true },
    });
    expect(device.received).toEqual(image.bytes);
  });

  it("resends from the offset the device asks for", async () => {
    const image = await parseMcubootImage(makeMcubootImage({ bodySize: 300 }));
    const device = new FakeSmpDevice();
    let dropped = false;
    device.onUpload = (payload) => {
      if (payload.off !== 128 || dropped) return undefined;
      dropped = true;
      return { rc: 0, off: 128 };
    };

    const { done } = await upload(device, image, { chunkSize: 128 });
    await done;

    expect(device.received).toEqual(image.bytes);
  });

  it("gives up on a device that stops accepting data", async () => {
    const image = await parseMcubootImage(makeMcubootImage());
    const device = new FakeSmpDevice();
    device.onUpload = () => ({ rc: 0, off: 0 });

    const { done } = await upload(device, image);

    await expect(done).rejects.toThrow("stopped accepting data at offset 0");
    expect(device.requests.filter((r) => r.id === IMG_MGMT_UPLOAD)).toHaveLength(3);
  });

  it.each([
    ["an error code", { rc: 5 }, "uploading failed (rc=5)"],
    ["no offset", { rc: 0 }, "missing offset"],
  ])("fails when a chunk is answered with %s", async (_name, reply, message) => {
    const image = await parseMcubootImage(makeMcubootImage());
    const device = new FakeSmpDevice();
    device.onUpload = () => reply;

    const { done } = await upload(device, image);

    await expect(done).rejects.toThrow(message);
  });

  it("fails when the uploaded image is not in the update slot", async () => {
    const image = await parseMcubootImage(makeMcubootImage({ bodySize: 10 }));
    const device = new FakeSmpDevice();
    device.onUpload = () => ({ rc: 0, off: image.bytes.length });

    const { done } = await upload(device, image);

    await expect(done).rejects.toThrow("secondary slot image not found");
  });

  it("stops at an abort", async () => {
    const image = await parseMcubootImage(makeMcubootImage({ bodySize: 600 }));
    const device = new FakeSmpDevice();
    const abort = new AbortController();
    device.onUpload = (payload) => {
      if (payload.off === 128) abort.abort(new Error("cancelled"));
      return undefined;
    };

    const { done } = await upload(device, image, { signal: abort.signal });

    await expect(done).rejects.toThrow("cancelled");
    expect(device.received.length).toBeLessThan(image.bytes.length);
  });
});
