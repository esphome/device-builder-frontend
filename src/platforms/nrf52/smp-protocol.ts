/**
 * SMP (Simple Management Protocol) engine used by both the BLE and serial
 * MCUboot OTA transports. Handles frame building/parsing, MCUboot image
 * validation, and the upload sequence (chunks → test → reset).
 */
import { cborDecode, cborEncode } from "./smp-cbor.js";

// SMP opcodes
export const MGMT_OP_READ = 0;
export const MGMT_OP_WRITE = 2;

// SMP management groups
export const MGMT_GROUP_OS = 0;
export const MGMT_GROUP_IMAGE = 1;

// OS group command IDs
export const OS_MGMT_RESET = 5;
export const OS_MGMT_MCUMGR_PARAMS = 6;

// Image group command IDs
export const IMG_MGMT_STATE = 0;
export const IMG_MGMT_UPLOAD = 1;

// MCUboot image magic bytes (little-endian uint32 at offset 0)
const MCUBOOT_MAGIC = 0x96f3b83d;

// SMP header is always 8 bytes.
const SMP_HEADER_SIZE = 8;
// CBOR overhead for the first upload chunk:
//   map(4)=1, "data"=5, bstr-len(2)=3, "off"=4, uint32=5,
//   "sha"=4, bstr(32)=34, "len"=4, uint32=5  → 65 bytes; +5 margin.
const SMP_UPLOAD_FIRST_OVERHEAD = 70;

// Fallback chunk sizes when OS_MGMT_MCUMGR_PARAMS is not available.
export const SMP_CHUNK_SIZE_BLE = 128;
export const SMP_CHUNK_SIZE_SERIAL = 128;

export interface SmpDeviceParams {
  /** Maximum SMP frame the device can receive, including the 8-byte header. */
  bufSize: number;
  /** Number of SMP receive buffers — safe pipeline depth. */
  bufCount: number;
}

/**
 * Query the device's SMP transport parameters (OS_MGMT_MCUMGR_PARAMS).
 * Returns null when the device does not support the command (older firmware).
 */
export async function smpQueryDeviceParams(
  transport: SmpTransport,
  signal?: AbortSignal
): Promise<SmpDeviceParams | null> {
  const frame = buildSmpFrame(MGMT_OP_READ, MGMT_GROUP_OS, OS_MGMT_MCUMGR_PARAMS, 0);
  try {
    const raw = await transport.exchange(frame, signal);
    const resp = parseSmpFrame(raw);
    const bufSize = resp.payload.buf_size;
    const bufCount = resp.payload.buf_count;
    if (
      typeof bufSize === "number" &&
      typeof bufCount === "number" &&
      bufSize > 0 &&
      bufCount > 0
    ) {
      return { bufSize, bufCount };
    }
  } catch {
    // Device doesn't support the command or timed out — use defaults.
  }
  return null;
}

/**
 * Derive the optimal data-chunk size from device params.
 *
 * The chunk size is bounded by the device's SMP reassembly buffer (`buf_size`),
 * NOT by the per-BLE-write limit: a single SMP frame is fragmented across
 * multiple ATT writes on the transport side and reassembled by the device, so
 * frames much larger than one ATT packet are fine. Bigger chunks mean far fewer
 * request→response round-trips, which is where the BLE throughput win comes from.
 */
export function chunkSizeFromParams(params: SmpDeviceParams): number {
  // The first chunk carries the largest overhead (sha + len fields); use that as the limit.
  return Math.max(params.bufSize - SMP_HEADER_SIZE - SMP_UPLOAD_FIRST_OVERHEAD, 64);
}

/**
 * Transport abstraction: send an SMP frame and receive the matching response.
 * Both BLE and serial implementations satisfy this interface. Strictly
 * request→response — one exchange completes before the next begins.
 */
export interface SmpTransport {
  exchange(frame: Uint8Array, signal?: AbortSignal): Promise<Uint8Array>;
  close(): void;
}

/** Build an SMP request frame (header + CBOR payload). */
export function buildSmpFrame(
  op: number,
  group: number,
  id: number,
  seq: number,
  payload?: unknown
): Uint8Array {
  const cbor = payload !== undefined ? cborEncode(payload) : new Uint8Array(0);
  const len = cbor.length;
  const frame = new Uint8Array(8 + len);
  frame[0] = op;
  frame[1] = 0; // flags
  frame[2] = (len >>> 8) & 0xff;
  frame[3] = len & 0xff;
  frame[4] = (group >>> 8) & 0xff;
  frame[5] = group & 0xff;
  frame[6] = seq & 0xff;
  frame[7] = id;
  frame.set(cbor, 8);
  return frame;
}

export interface SmpFrameInfo {
  op: number;
  group: number;
  seq: number;
  id: number;
  payload: Record<string, unknown>;
}

/** Parse an SMP response frame. */
export function parseSmpFrame(data: Uint8Array): SmpFrameInfo {
  if (data.length < 8) throw new Error("SMP: frame too short");
  const op = data[0];
  const payloadLen = (data[2] << 8) | data[3];
  const group = (data[4] << 8) | data[5];
  const seq = data[6];
  const id = data[7];
  const raw = data.length > 8 ? cborDecode(data.subarray(8, 8 + payloadLen)) : {};
  const payload =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return { op, group, seq, id, payload };
}

// MCUboot TLV constants.
const IMAGE_TLV_INFO_MAGIC = 0x6907; // unprotected TLV area magic
const IMAGE_TLV_SHA256 = 0x10;

/** MCUboot image header information extracted before the upload. */
export interface McubootImageInfo {
  /** Semantic version string, e.g. "1.0.0". */
  version: string;
  /** Image payload size in bytes (as declared in header). */
  imageSize: number;
  /** SHA-256 hash of the full image (for the SMP upload sha field). */
  hash: Uint8Array;
  /**
   * The MCUboot image hash from the image's SHA256 TLV — this is the value the
   * device reports for each slot in the image list, so it's what we compare
   * against to tell whether the device already has this image. Undefined when
   * the TLV can't be located (e.g. an unexpected layout).
   */
  imageHash?: Uint8Array;
}

/**
 * Locate the SHA256 TLV in a MCUboot image and return its 32-byte value. This
 * is the hash the device stores and reports per slot. Returns undefined if the
 * TLV area or the SHA256 entry can't be found.
 */
function findImageHashTlv(
  bytes: Uint8Array,
  view: DataView,
  hdrSize: number,
  imageSize: number,
  protectTlvSize: number
): Uint8Array | undefined {
  // The unprotected TLV area follows the header, the image body, and the
  // (optional) protected TLV area.
  const tlvOff = hdrSize + imageSize + protectTlvSize;
  if (tlvOff + 4 > bytes.length) return undefined;
  if (view.getUint16(tlvOff, true) !== IMAGE_TLV_INFO_MAGIC) return undefined;

  const tlvTotal = view.getUint16(tlvOff + 2, true);
  const end = Math.min(tlvOff + tlvTotal, bytes.length);
  let p = tlvOff + 4; // skip the image_tlv_info header
  while (p + 4 <= end) {
    const type = view.getUint8(p);
    const len = view.getUint16(p + 2, true);
    const valueStart = p + 4;
    if (type === IMAGE_TLV_SHA256 && len === 32 && valueStart + 32 <= bytes.length) {
      return bytes.slice(valueStart, valueStart + 32);
    }
    p = valueStart + len;
  }
  return undefined;
}

/**
 * Parse and validate a MCUboot-signed firmware binary. Throws on invalid magic,
 * wrong load address, or size mismatch; does not verify the TLV hash.
 */
export async function parseMcubootImageInfo(
  bytes: Uint8Array
): Promise<McubootImageInfo> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.length < 32) throw new Error("Invalid MCUboot image (too short)");

  const magic = view.getUint32(0, true);
  if (magic !== MCUBOOT_MAGIC) {
    throw new Error(`Invalid MCUboot image (bad magic: 0x${magic.toString(16)})`);
  }

  const loadAddr = view.getUint32(4, true);
  if (loadAddr !== 0) {
    throw new Error(
      `Invalid MCUboot image (non-zero load address: 0x${loadAddr.toString(16)})`
    );
  }

  const hdrSize = view.getUint16(8, true);
  const protectTlvSize = view.getUint16(10, true);
  const imageSize = view.getUint32(12, true);
  const major = view.getUint8(20);
  const minor = view.getUint8(21);
  const revision = view.getUint16(22, true);
  const version = `${major}.${minor}.${revision}`;

  const slice = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const hashBuf = await crypto.subtle.digest("SHA-256", slice);
  const hash = new Uint8Array(hashBuf);

  const imageHash = findImageHashTlv(bytes, view, hdrSize, imageSize, protectTlvSize);

  return { version, imageSize, hash, imageHash };
}

export interface SmpUploadHooks {
  onProgress(percent: number): void;
  onLog?(line: string): void;
  signal?: AbortSignal;
}

/**
 * Upload a MCUboot firmware image via the given SMP transport, then mark it
 * for testing and reset the device. Throws on error or abort.
 */
export async function smpUploadImage(
  transport: SmpTransport,
  image: Uint8Array,
  info: McubootImageInfo,
  chunkSize: number,
  hooks: SmpUploadHooks
): Promise<void> {
  const { onProgress, onLog, signal } = hooks;
  const log = onLog ?? (() => {});
  let seq = 0;

  async function exchange(frame: Uint8Array): Promise<SmpFrameInfo> {
    const resp = await transport.exchange(frame, signal);
    return parseSmpFrame(resp);
  }

  const kb = (n: number) => (n / 1024).toFixed(1);
  const bytesEqual = (a: Uint8Array, b: Uint8Array) =>
    a.length === b.length && a.every((v, i) => v === b[i]);

  interface ImageState {
    activeHash?: Uint8Array; // the running image (slot 0 / active)
    activeConfirmed?: boolean; // whether the running image is confirmed
    slot1Hash?: Uint8Array; // the secondary/update slot
  }

  /** Read the image-state list and pick out the hashes we need. */
  async function readImageState(): Promise<ImageState> {
    const listFrame = buildSmpFrame(
      MGMT_OP_READ,
      MGMT_GROUP_IMAGE,
      IMG_MGMT_STATE,
      seq++
    );
    const listResp = await exchange(listFrame);
    const images = listResp.payload.images;
    const state: ImageState = {};
    if (Array.isArray(images)) {
      for (const img of images) {
        if (img && typeof img === "object") {
          const entry = img as Record<string, unknown>;
          if (
            state.slot1Hash === undefined &&
            entry.slot === 1 &&
            entry.hash instanceof Uint8Array
          ) {
            state.slot1Hash = entry.hash;
          }
          if (
            state.activeHash === undefined &&
            entry.active === true &&
            entry.hash instanceof Uint8Array
          ) {
            state.activeHash = entry.hash;
            state.activeConfirmed = entry.confirmed === true;
          }
        }
      }
    }
    return state;
  }

  /** Confirm (make permanent) the currently-running image. */
  async function confirmActiveImage(hash: Uint8Array): Promise<void> {
    const frame = buildSmpFrame(MGMT_OP_WRITE, MGMT_GROUP_IMAGE, IMG_MGMT_STATE, seq++, {
      hash,
      confirm: true,
    });
    const resp = await exchange(frame);
    const rc = typeof resp.payload.rc === "number" ? resp.payload.rc : 0;
    if (rc !== 0) throw new Error(`SMP: confirming the running image failed (rc=${rc})`);
  }

  log(`Firmware version ${info.version}, ${kb(image.length)} KB`);

  // Check the device's current image state BEFORE uploading, so we can skip the
  // 200+ KB transfer when the device already has this exact image. The image
  // list reports MCUboot's image hash (the SHA256 TLV), which is `info.imageHash`.
  log("Checking device image status");
  let before = await readImageState();

  // If the device is running an unconfirmed test image, the secondary slot still
  // holds the confirmed fallback and MCUboot rejects a new upload (EBADSTATE).
  // Confirm the running image first to free the update slot.
  if (before.activeHash && before.activeConfirmed === false) {
    log("Running image is not confirmed — confirming it to free the update slot");
    await confirmActiveImage(before.activeHash);
    before = await readImageState();
  }
  if (info.imageHash) {
    if (before.activeHash && bytesEqual(before.activeHash, info.imageHash)) {
      log("Device is already running this exact firmware — nothing to do.");
      onProgress(100);
      return;
    }
    if (before.slot1Hash && bytesEqual(before.slot1Hash, info.imageHash)) {
      // The image is already in the update slot from a previous upload; skip the
      // transfer and go straight to marking it for test.
      log("This image is already in the update slot — skipping upload.");
      await testAndReset(before.slot1Hash);
      return;
    }
  } else {
    log("Could not read this image's hash TLV; uploading unconditionally.");
  }

  const totalChunks = Math.ceil(image.length / chunkSize);
  log(`Transferring in ${totalChunks} packets of up to ${chunkSize} bytes`);

  // Strictly sequential request→response. The mcumgr SMP-over-BLE transport
  // handles one request at a time and reassembles incoming writes by length;
  // a second request sent before the current one is ACK'd corrupts the
  // device's reassembly buffer. Speed comes from a larger `chunkSize` (fewer
  // round-trips), negotiated via OS_MGMT_MCUMGR_PARAMS — not from pipelining.
  const startedAt = Date.now();
  let offset = 0;
  let lastLoggedPct = -1;
  while (offset < image.length) {
    if (signal?.aborted) throw signal.reason;

    const end = Math.min(offset + chunkSize, image.length);
    const chunk = image.subarray(offset, end);
    const payload: Record<string, unknown> = { data: chunk, off: offset };
    if (offset === 0) {
      payload.sha = info.hash;
      payload.len = image.length;
    }

    const frame = buildSmpFrame(
      MGMT_OP_WRITE,
      MGMT_GROUP_IMAGE,
      IMG_MGMT_UPLOAD,
      seq++,
      payload
    );
    const resp = await exchange(frame);

    if (resp.group !== MGMT_GROUP_IMAGE || resp.id !== IMG_MGMT_UPLOAD) {
      throw new Error("SMP: unexpected response group/id during upload");
    }
    const rc = typeof resp.payload.rc === "number" ? resp.payload.rc : 0;
    if (rc !== 0) throw new Error(`SMP: device returned error ${rc} during upload`);

    const deviceOff = resp.payload.off;
    if (typeof deviceOff !== "number")
      throw new Error("SMP: missing offset in upload response");

    // The device dictates the next offset (it may re-request on a partial write).
    offset = deviceOff;
    const pct = Math.floor((offset / image.length) * 95);
    onProgress(pct);

    // Log a status line every 10% so the terminal shows the transfer advancing
    // with throughput, without flooding it with a line per packet.
    const decile = Math.floor((offset / image.length) * 10) * 10;
    if (decile > lastLoggedPct) {
      lastLoggedPct = decile;
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = elapsed > 0 ? offset / elapsed / 1024 : 0;
      log(
        `${decile}% — ${kb(offset)} / ${kb(image.length)} KB (${rate.toFixed(1)} KB/s)`
      );
    }
  }
  const elapsed = (Date.now() - startedAt) / 1000;
  log(
    `Upload finished: ${kb(image.length)} KB in ${elapsed.toFixed(1)} s (${(image.length / elapsed / 1024).toFixed(1)} KB/s)`
  );

  // Re-read the image list to get the hash the device assigned to the freshly
  // uploaded image in the update slot.
  log("Fetching image list");
  const after = await readImageState();
  const slotHash = after.slot1Hash;
  if (!slotHash) throw new Error("SMP: secondary slot image not found after upload");

  // Guard: if the just-uploaded image is byte-identical to the running one, the
  // device is already on this firmware; marking it for test would fail.
  if (after.activeHash && bytesEqual(after.activeHash, slotHash)) {
    log("Device is already running this exact firmware — nothing to do.");
    onProgress(100);
    return;
  }

  await testAndReset(slotHash);

  /** Mark the given image hash for test boot, then reset the device. */
  async function testAndReset(hash: Uint8Array): Promise<void> {
    onProgress(96);
    log("Marking uploaded image for test boot");
    const testFrame = buildSmpFrame(
      MGMT_OP_WRITE,
      MGMT_GROUP_IMAGE,
      IMG_MGMT_STATE,
      seq++,
      { hash, confirm: false }
    );
    const testResp = await exchange(testFrame);
    const testRc = typeof testResp.payload.rc === "number" ? testResp.payload.rc : 0;
    if (testRc !== 0) throw new Error(`SMP: image test failed (rc=${testRc})`);

    onProgress(98);
    // Give the device a moment to finish persisting the image-state write before
    // we ask it to reboot, so the pending/test flag is durably stored first.
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    log("Resetting device to boot the new image");
    const resetFrame = buildSmpFrame(
      MGMT_OP_WRITE,
      MGMT_GROUP_OS,
      OS_MGMT_RESET,
      seq++,
      {}
    );
    // The device may drop the connection before responding to reset; ignore errors here.
    try {
      await exchange(resetFrame);
    } catch {
      // Expected: device resets before the ACK arrives.
    }
    log("Done — the device is rebooting into the new firmware");
    onProgress(100);
  }
}
