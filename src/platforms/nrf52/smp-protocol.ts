/**
 * The SMP (Simple Management Protocol) side of an MCUboot update, shared by
 * the Bluetooth and serial transports: frames, image validation, and the
 * upload sequence (chunks, mark for test, reset).
 */
import { getErrorMessage } from "../../util/error-message.js";
import { sleep } from "../../util/sleep.js";
import { withDeadline } from "../../util/with-deadline.js";
import { cborDecode, cborEncode } from "./smp-cbor.js";

export const MGMT_OP_READ = 0;
export const MGMT_OP_WRITE = 2;

export const MGMT_GROUP_OS = 0;
export const MGMT_GROUP_IMAGE = 1;

export const OS_MGMT_RESET = 5;
export const OS_MGMT_MCUMGR_PARAMS = 6;

export const IMG_MGMT_STATE = 0;
export const IMG_MGMT_UPLOAD = 1;

// MCUboot image magic bytes (little-endian uint32 at offset 0)
const MCUBOOT_MAGIC = 0x96f3b83d;

// SMP header is always 8 bytes.
const SMP_HEADER_SIZE = 8;
// CBOR overhead for the first upload chunk:
//   map(4)=1, "data"=5, bstr-len(2)=3, "off"=4, uint32=5,
//   "sha"=4, bstr(32)=34, "len"=4, uint32=5: 65 bytes, plus a margin of 5.
const SMP_UPLOAD_FIRST_OVERHEAD = 70;

/** The chunk size for a device that does not report its buffer. */
export const SMP_CHUNK_SIZE_DEFAULT = 128;

// Responses in a row that may leave the offset where it was before the
// device counts as stuck.
const MAX_STALLED_CHUNKS = 3;

/** The device answered and refused, as opposed to the link failing. */
export class SmpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmpError";
  }
}

/** The request went out and no reply came back: the link dropped, or timed out. */
export class SmpNoReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmpNoReplyError";
  }
}

export interface SmpDeviceParams {
  /** Maximum SMP frame the device can receive, including the 8-byte header. */
  bufSize: number;
  /** Number of SMP receive buffers. */
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
  } catch (err) {
    // Older firmware has no such command: it refuses it or stays silent,
    // and the caller falls back. Anything else is a real failure.
    if (!(err instanceof SmpError || err instanceof SmpNoReplyError)) throw err;
  }
  return null;
}

/**
 * The largest data chunk the device's reassembly buffer takes. The buffer
 * bounds it, not one Bluetooth write: a frame is split across writes and
 * reassembled, and fewer round-trips is where the throughput comes from.
 */
export function chunkSizeFromParams(params: SmpDeviceParams): number {
  // The first chunk carries the largest overhead (sha + len fields); use that as the limit.
  return Math.max(params.bufSize - SMP_HEADER_SIZE - SMP_UPLOAD_FIRST_OVERHEAD, 64);
}

/**
 * Sends an SMP frame and returns the response to it. One exchange completes
 * before the next begins: mcumgr handles a single request at a time. Throws
 * ``SmpNoReplyError`` when the frame went out and nothing came back, and the
 * abort reason on a cancel.
 */
export interface SmpTransport {
  exchange(frame: Uint8Array, signal?: AbortSignal): Promise<Uint8Array>;
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
   * The image's SHA256 TLV: the hash the device reports for each slot, so
   * the one that says whether it already holds this image. Undefined when
   * the TLV can't be located.
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
 * The reply to a frame that has gone out, for a transport. A cancel passes
 * through; any other failure to get one is ``SmpNoReplyError``.
 */
export async function awaitReply(
  reply: Promise<Uint8Array>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  try {
    return await withDeadline(
      reply,
      timeoutMs,
      () => new Error("SMP: no response from the device")
    );
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new SmpNoReplyError(getErrorMessage(err));
  }
}

/** A validated MCUboot image, ready to upload. */
export interface McubootImage {
  bytes: Uint8Array;
  info: McubootImageInfo;
}

/**
 * Validate an MCUboot firmware binary. Throws on a bad magic or load
 * address; does not verify the TLV hash.
 */
export async function parseMcubootImage(bytes: Uint8Array): Promise<McubootImage> {
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
  if (hdrSize + imageSize + protectTlvSize > bytes.length) {
    throw new Error("Invalid MCUboot image (truncated)");
  }

  const slice = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const hashBuf = await crypto.subtle.digest("SHA-256", slice);
  const hash = new Uint8Array(hashBuf);

  const imageHash = findImageHashTlv(bytes, view, hdrSize, imageSize, protectTlvSize);

  return { bytes, info: { version, imageSize, hash, imageHash } };
}

export interface SmpUploadHooks {
  onProgress(percent: number): void;
  onLog?(line: string): void;
  signal?: AbortSignal;
}

/** One upload's requests: numbers them and turns an error reply into a throw. */
class SmpClient {
  private seq = 0;

  constructor(
    private readonly transport: SmpTransport,
    private readonly signal?: AbortSignal
  ) {}

  /** *failed* names the step in the error for a reply with a non-zero ``rc``. */
  async request(
    op: number,
    group: number,
    id: number,
    payload: unknown,
    failed: string
  ): Promise<SmpFrameInfo> {
    const frame = buildSmpFrame(op, group, id, this.seq++, payload);
    const reply = parseSmpFrame(await this.transport.exchange(frame, this.signal));
    if (reply.group !== group || reply.id !== id) {
      throw new SmpError(`SMP: unexpected reply while ${failed}`);
    }
    const rc = reply.payload.rc;
    if (typeof rc === "number" && rc !== 0) {
      throw new SmpError(`SMP: ${failed} failed (rc=${rc})`);
    }
    return reply;
  }
}

interface ImageState {
  /** The running image. */
  active?: { hash: Uint8Array; confirmed: boolean };
  /** The image in the update slot. */
  update?: Uint8Array;
}

async function readImageState(client: SmpClient): Promise<ImageState> {
  const reply = await client.request(
    MGMT_OP_READ,
    MGMT_GROUP_IMAGE,
    IMG_MGMT_STATE,
    undefined,
    "reading the image list"
  );
  const images = Array.isArray(reply.payload.images) ? reply.payload.images : [];
  const hashed = images.filter(
    (image): image is Record<string, unknown> & { hash: Uint8Array } =>
      typeof image === "object" && image !== null && image.hash instanceof Uint8Array
  );
  const active = hashed.find((image) => image.active === true);
  return {
    active: active && { hash: active.hash, confirmed: active.confirmed === true },
    update: hashed.find((image) => image.slot === 1)?.hash,
  };
}

const setImageState = (
  client: SmpClient,
  hash: Uint8Array,
  confirm: boolean,
  failed: string
): Promise<SmpFrameInfo> =>
  client.request(
    MGMT_OP_WRITE,
    MGMT_GROUP_IMAGE,
    IMG_MGMT_STATE,
    { hash, confirm },
    failed
  );

const bytesEqual = (a: Uint8Array | undefined, b: Uint8Array | undefined): boolean =>
  a !== undefined &&
  b !== undefined &&
  a.length === b.length &&
  a.every((v, i) => v === b[i]);

const kb = (bytes: number): string => (bytes / 1024).toFixed(1);

/** Send the image in chunks, from the offset the device asks for each time. */
async function sendChunks(
  client: SmpClient,
  { bytes: image, info }: McubootImage,
  chunkSize: number,
  { onProgress, onLog, signal }: SmpUploadHooks
): Promise<void> {
  const packets = Math.ceil(image.length / chunkSize);
  onLog?.(`Transferring in ${packets} packets of up to ${chunkSize} bytes`);
  const startedAt = Date.now();
  let offset = 0;
  let stalled = 0;
  let loggedDecile = -1;
  while (offset < image.length) {
    if (signal?.aborted) throw signal.reason;
    const data = image.subarray(offset, Math.min(offset + chunkSize, image.length));
    const reply = await client.request(
      MGMT_OP_WRITE,
      MGMT_GROUP_IMAGE,
      IMG_MGMT_UPLOAD,
      offset === 0
        ? { data, off: offset, sha: info.hash, len: image.length }
        : { data, off: offset },
      "uploading"
    );
    const next = reply.payload.off;
    if (typeof next !== "number") {
      throw new Error("SMP: missing offset in upload response");
    }
    // The device dictates the next offset: it re-requests a partial write.
    stalled = next > offset ? 0 : stalled + 1;
    if (stalled >= MAX_STALLED_CHUNKS) {
      throw new Error(`SMP: the device stopped accepting data at offset ${offset}`);
    }
    offset = next;
    onProgress(Math.floor((offset / image.length) * 95));

    const decile = Math.floor((offset / image.length) * 10) * 10;
    if (decile > loggedDecile) {
      loggedDecile = decile;
      const seconds = (Date.now() - startedAt) / 1000;
      const rate = seconds > 0 ? offset / seconds / 1024 : 0;
      onLog?.(
        `${decile}%: ${kb(offset)} / ${kb(image.length)} KB (${rate.toFixed(1)} KB/s)`
      );
    }
  }
}

/** Mark the image with *hash* for a test boot, then reset the device. */
async function testAndReset(
  client: SmpClient,
  hash: Uint8Array,
  { onProgress, onLog }: SmpUploadHooks
): Promise<void> {
  onProgress(96);
  onLog?.("Marking uploaded image for test boot");
  await setImageState(client, hash, false, "marking the image for test");
  onProgress(98);
  // The test flag has to be stored before the device reboots.
  await sleep(1000);
  onLog?.("Resetting device to boot the new image");
  await client
    .request(MGMT_OP_WRITE, MGMT_GROUP_OS, OS_MGMT_RESET, {}, "resetting")
    .catch((err: unknown) => {
      // The device resets before its reply arrives, so no reply is the
      // expected outcome; a request that never went out is not.
      if (!(err instanceof SmpNoReplyError)) throw err;
    });
  onLog?.("Done; the device is rebooting into the new firmware");
  onProgress(100);
}

/**
 * Upload an MCUboot image over *transport*, mark it for test and reset the
 * device. Throws on error or abort.
 */
export async function smpUploadImage(
  transport: SmpTransport,
  image: McubootImage,
  chunkSize: number,
  hooks: SmpUploadHooks
): Promise<void> {
  const { onProgress, onLog } = hooks;
  const { info } = image;
  const client = new SmpClient(transport, hooks.signal);
  const alreadyRunning = (state: ImageState, hash?: Uint8Array): boolean => {
    if (!bytesEqual(state.active?.hash, hash)) return false;
    onLog?.("Device is already running this exact firmware; nothing to do.");
    onProgress(100);
    return true;
  };

  onLog?.(`Firmware version ${info.version}, ${kb(image.bytes.length)} KB`);
  // The image list reports MCUboot's image hash (the SHA256 TLV), so a device
  // that already holds this image skips the transfer.
  onLog?.("Checking device image status");
  let before = await readImageState(client);
  // While an unconfirmed test image runs, the update slot holds the confirmed
  // fallback and MCUboot rejects an upload (EBADSTATE).
  if (before.active && !before.active.confirmed) {
    onLog?.("Running image is not confirmed; confirming it to free the update slot");
    await setImageState(client, before.active.hash, true, "confirming the running image");
    before = await readImageState(client);
  }
  if (!info.imageHash) {
    onLog?.("Could not read this image's hash TLV; uploading unconditionally.");
  } else if (alreadyRunning(before, info.imageHash)) {
    return;
  } else if (bytesEqual(before.update, info.imageHash)) {
    onLog?.("This image is already in the update slot; skipping upload.");
    await testAndReset(client, info.imageHash, hooks);
    return;
  }

  const startedAt = Date.now();
  await sendChunks(client, image, chunkSize, hooks);
  const seconds = (Date.now() - startedAt) / 1000;
  const size = kb(image.bytes.length);
  const rate = (image.bytes.length / seconds / 1024).toFixed(1);
  onLog?.(`Upload finished: ${size} KB in ${seconds.toFixed(1)} s (${rate} KB/s)`);

  onLog?.("Fetching image list");
  const after = await readImageState(client);
  if (!after.update) throw new Error("SMP: secondary slot image not found after upload");
  if (info.imageHash && !bytesEqual(after.update, info.imageHash)) {
    throw new Error("SMP: the update slot holds a different image after upload");
  }
  // Marking the running image for test would fail.
  if (alreadyRunning(after, after.update)) return;
  await testAndReset(client, after.update, hooks);
}
