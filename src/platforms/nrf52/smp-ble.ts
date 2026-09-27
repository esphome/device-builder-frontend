/**
 * MCUboot updates over the mcumgr SMP GATT service: the Bluetooth transport
 * for ``smp-protocol``.
 */
import { SMP_BLE_CHARACTERISTIC_UUID, SMP_BLE_SERVICE_UUID } from "./smp-ble-service.js";
import {
  chunkSizeFromParams,
  type McubootImage,
  SMP_CHUNK_SIZE_DEFAULT,
  smpQueryDeviceParams,
  type SmpTransport,
  type SmpUploadHooks,
  smpUploadImage,
} from "./smp-protocol.js";

/** The picked device has no SMP service: not an mcumgr build, or the wrong device. */
export class SmpBleServiceNotFoundError extends Error {
  constructor() {
    super("SMP Bluetooth service not found");
    this.name = "SmpBleServiceNotFoundError";
  }
}

const BLE_EXCHANGE_TIMEOUT_MS = 10_000;
// Web Bluetooth does not expose the negotiated MTU, so stay within the
// standard 247-byte one, less 3 bytes of ATT header.
const BLE_WRITE_FRAGMENT = 244;

class SmpBleTransport implements SmpTransport {
  private readonly pending = new Map<number, (frame: Uint8Array) => void>();
  private readonly pendingReject = new Map<number, (err: Error) => void>();
  private rxBuf = new Uint8Array(0);
  private readonly onValueChanged: (e: Event) => void;
  private readonly onDisconnected: () => void;

  constructor(
    private readonly characteristic: BluetoothRemoteGATTCharacteristic,
    private readonly device: BluetoothDevice
  ) {
    this.onValueChanged = () => this.handleNotification();
    this.onDisconnected = () => this.rejectAll(new Error("SMP: the device disconnected"));
    characteristic.addEventListener("characteristicvaluechanged", this.onValueChanged);
    device.addEventListener("gattserverdisconnected", this.onDisconnected);
  }

  private rejectAll(err: Error): void {
    // Snapshot first: each reject's cleanup mutates the map.
    const rejects = [...this.pendingReject.values()];
    this.pending.clear();
    this.pendingReject.clear();
    for (const reject of rejects) reject(err);
  }

  private handleNotification(): void {
    const val = this.characteristic.value;
    if (!val) return;
    // val.buffer may be a larger shared ArrayBuffer; stay inside the window.
    const chunk = new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
    const merged = new Uint8Array(this.rxBuf.length + chunk.length);
    merged.set(this.rxBuf);
    merged.set(chunk, this.rxBuf.length);
    this.rxBuf = merged;

    while (this.rxBuf.length >= 8) {
      const payloadLen = (this.rxBuf[2] << 8) | this.rxBuf[3];
      const frameLen = 8 + payloadLen;
      if (this.rxBuf.length < frameLen) break;

      const frame = this.rxBuf.slice(0, frameLen);
      this.rxBuf = this.rxBuf.slice(frameLen);

      const seq = frame[6];
      this.pending.get(seq)?.(frame);
    }
  }

  async exchange(frame: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
    const seq = frame[6];

    const response = new Promise<Uint8Array>((resolve, reject) => {
      // Cleaned up synchronously, so close() never finds a settled entry
      // and raises an unhandled rejection for it.
      const cleanup = () => {
        clearTimeout(timer);
        this.pending.delete(seq);
        this.pendingReject.delete(seq);
      };

      let timer: ReturnType<typeof setTimeout>;

      this.pending.set(seq, (f) => {
        cleanup();
        resolve(f);
      });
      this.pendingReject.set(seq, (e) => {
        cleanup();
        reject(e);
      });

      timer = setTimeout(() => {
        if (this.pending.has(seq)) {
          cleanup();
          reject(new Error("SMP: no response from the device"));
        }
      }, BLE_EXCHANGE_TIMEOUT_MS);

      signal?.addEventListener(
        "abort",
        () => {
          if (this.pending.has(seq)) {
            cleanup();
            reject(signal.reason);
          }
        },
        { once: true }
      );
    });

    // An SMP frame can exceed the ATT MTU; mcumgr reassembles one frame
    // across writes by its length field.
    for (let start = 0; start < frame.length; start += BLE_WRITE_FRAGMENT) {
      const piece = frame.subarray(start, start + BLE_WRITE_FRAGMENT);
      const buf = piece.buffer.slice(
        piece.byteOffset,
        piece.byteOffset + piece.byteLength
      ) as ArrayBuffer;
      await this.writeFragment(buf, seq);
    }
    return response;
  }

  /** Write one MTU-sized fragment, retrying on transient GATT-busy errors. */
  private async writeFragment(buf: ArrayBuffer, seq: number): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.characteristic.writeValueWithoutResponse(buf);
        return;
      } catch (err) {
        if (
          attempt >= 2 ||
          (err instanceof DOMException && err.name !== "NetworkError")
        ) {
          this.pendingReject.get(seq)?.(
            err instanceof Error ? err : new Error(String(err))
          );
          throw err;
        }
        await new Promise<void>((r) => setTimeout(r, 100 * (attempt + 1)));
      }
    }
  }

  close(): void {
    this.characteristic.removeEventListener(
      "characteristicvaluechanged",
      this.onValueChanged
    );
    this.device.removeEventListener("gattserverdisconnected", this.onDisconnected);
    this.rejectAll(new Error("SMP: transport closed"));
    this.device.gatt?.disconnect();
  }
}

async function connectSmpBle(device: BluetoothDevice): Promise<SmpBleTransport> {
  if (!device.gatt) throw new Error("SMP: the device has no GATT server");
  const server = await device.gatt.connect();
  const service = await server
    .getPrimaryService(SMP_BLE_SERVICE_UUID)
    .catch((err: unknown) => {
      if (err instanceof DOMException && err.name === "NotFoundError") {
        throw new SmpBleServiceNotFoundError();
      }
      throw err;
    });
  const characteristic = await service.getCharacteristic(SMP_BLE_CHARACTERISTIC_UUID);
  await characteristic.startNotifications();
  return new SmpBleTransport(characteristic, device);
}

/** Connect to *device*, upload *image* and boot it; the link is closed either way. */
export async function flashMcubootOverBle(
  device: BluetoothDevice,
  image: McubootImage,
  hooks: SmpUploadHooks
): Promise<void> {
  hooks.onLog?.(`Connecting to ${device.name ?? "device"} over Bluetooth`);
  const transport = await connectSmpBle(device);
  try {
    const params = await smpQueryDeviceParams(transport, hooks.signal);
    const chunkSize = params ? chunkSizeFromParams(params) : SMP_CHUNK_SIZE_DEFAULT;
    hooks.onLog?.(
      params
        ? `Device buffer: ${params.bufSize} bytes x ${params.bufCount}; using ${chunkSize}-byte chunks`
        : `Device did not report parameters; using ${chunkSize}-byte chunks`
    );
    await smpUploadImage(transport, image, chunkSize, hooks);
  } finally {
    transport.close();
  }
}
