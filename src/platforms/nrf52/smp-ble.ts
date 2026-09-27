/**
 * MCUboot updates over the mcumgr SMP GATT service: the Bluetooth transport
 * for ``smp-protocol``.
 */
import { concat } from "../../util/bytes.js";
import { sleep } from "../../util/sleep.js";
import { SMP_BLE_CHARACTERISTIC_UUID, SMP_BLE_SERVICE_UUID } from "./smp-ble-service.js";
import {
  awaitReply,
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
  // One exchange at a time, so one reply is ever awaited.
  private pending: { seq: number; settle(frame: Uint8Array | Error): void } | null = null;
  private rxBuf: Uint8Array = new Uint8Array(0);
  private readonly onValueChanged = () => this.handleNotification();
  private readonly onDisconnected = () =>
    this.pending?.settle(new Error("SMP: the device disconnected"));

  constructor(
    private readonly characteristic: BluetoothRemoteGATTCharacteristic,
    private readonly device: BluetoothDevice
  ) {
    characteristic.addEventListener("characteristicvaluechanged", this.onValueChanged);
    device.addEventListener("gattserverdisconnected", this.onDisconnected);
  }

  private handleNotification(): void {
    const val = this.characteristic.value;
    if (!val) return;
    // val.buffer may be a larger shared ArrayBuffer; stay inside the window.
    this.rxBuf = concat(
      this.rxBuf,
      new Uint8Array(val.buffer, val.byteOffset, val.byteLength)
    );
    while (this.rxBuf.length >= 8) {
      const frameLen = 8 + ((this.rxBuf[2] << 8) | this.rxBuf[3]);
      if (this.rxBuf.length < frameLen) break;
      const frame = this.rxBuf.slice(0, frameLen);
      this.rxBuf = this.rxBuf.slice(frameLen);
      if (this.pending?.seq === frame[6]) this.pending.settle(frame);
    }
  }

  async exchange(frame: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
    const onAbort = () => this.pending?.settle(signal?.reason as Error);
    // Whatever an earlier exchange left behind is not this one's reply.
    this.rxBuf = new Uint8Array(0);
    const response = new Promise<Uint8Array>((resolve, reject) => {
      this.pending = {
        seq: frame[6],
        settle: (result) => {
          this.pending = null;
          if (result instanceof Uint8Array) resolve(result);
          else reject(result);
        },
      };
    });
    // A write that fails after the link dropped leaves this unawaited.
    response.catch(() => {});
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      if (signal?.aborted) throw signal.reason;
      // An SMP frame can exceed the ATT MTU; mcumgr reassembles one frame
      // across writes by its length field.
      for (let start = 0; start < frame.length; start += BLE_WRITE_FRAGMENT) {
        await this.writeFragment(frame.slice(start, start + BLE_WRITE_FRAGMENT));
      }
      return await awaitReply(response, BLE_EXCHANGE_TIMEOUT_MS, signal);
    } finally {
      this.pending = null;
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /** Write one MTU-sized fragment, retrying while the GATT stack is busy. */
  private async writeFragment(fragment: Uint8Array<ArrayBuffer>): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.characteristic.writeValueWithoutResponse(fragment);
        return;
      } catch (err) {
        const busy = err instanceof DOMException && err.name === "NetworkError";
        if (attempt >= 2 || !busy) throw err;
        await sleep(100 * (attempt + 1));
      }
    }
  }

  close(): void {
    this.characteristic.removeEventListener(
      "characteristicvaluechanged",
      this.onValueChanged
    );
    this.device.removeEventListener("gattserverdisconnected", this.onDisconnected);
    this.pending?.settle(new Error("SMP: transport closed"));
    this.device.gatt?.disconnect();
  }
}

async function connectSmpBle(device: BluetoothDevice): Promise<SmpBleTransport> {
  if (!device.gatt) throw new Error("SMP: the device has no GATT server");
  const server = await device.gatt.connect();
  try {
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
  } catch (err) {
    device.gatt.disconnect();
    throw err;
  }
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
