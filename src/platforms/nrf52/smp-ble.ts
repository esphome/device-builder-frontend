/**
 * MCUboot OTA via BLE SMP — transport and install flow.
 * Uses the Zephyr/MCUboot SMP GATT service (the same service mcumgr-web uses).
 */
import type { LocalizeFunc } from "../../common/localize.js";
import type { ESPHomeFirmwareInstallDialog } from "../../components/firmware-install-dialog.js";
import {
  downloadBuildArtifact,
  installLog,
} from "../../components/firmware-install-dialog/browser-flash-steps.js";
import { getErrorMessage } from "../../util/error-message.js";
import { isPortPickerCancel } from "../../util/web-serial.js";
import {
  type BrowserInstall,
  FLASH_ACTION_KEY,
  FlashImageSlot,
} from "../platform-support.js";
import {
  chunkSizeFromParams,
  type McubootImageInfo,
  parseMcubootImageInfo,
  SMP_CHUNK_SIZE_BLE,
  smpQueryDeviceParams,
  type SmpTransport,
  smpUploadImage,
} from "./smp-protocol.js";

declare module "../platform-support.js" {
  interface BrowserFlasherSteps {
    "nrf-smp-ble": "nrf-smp-ble-ready";
  }
}

const SMP_SERVICE_UUID = "8d53dc1d-1db7-4cd3-868b-8a527460aa84";
const SMP_CHARACTERISTIC_UUID = "da2e7828-fbce-4e01-ae9e-261174997c48";

/** Parsed MCUboot image kept across Retry. */
interface McubootImageSlotData {
  image: Uint8Array;
  info: McubootImageInfo;
}

export const nrfSmpBleImage = new FlashImageSlot<McubootImageSlotData>();

/** The BLE SMP characteristic does not need Web Serial. */
export const NRF_SMP_BLE_REQUIRES_WEB_SERIAL = false;

/**
 * Open the BLE device chooser for an SMP-capable device.
 * Names are used to pre-filter; with none the picker shows all devices.
 */
export async function requestSmpBleDevice(
  names: string[]
): Promise<BluetoothDevice | null> {
  const known = [...new Set(names.filter(Boolean))];
  const options: RequestDeviceOptions = known.length
    ? {
        filters: known.map((name) => ({ name })),
        optionalServices: [SMP_SERVICE_UUID],
      }
    : { acceptAllDevices: true, optionalServices: [SMP_SERVICE_UUID] };
  try {
    return await navigator.bluetooth.requestDevice(options);
  } catch (err) {
    if (!isPortPickerCancel(err)) throw err;
    return null;
  }
}

/** SMP transport backed by a BLE GATT characteristic. */
// Milliseconds to wait for a response notification before giving up.
const BLE_EXCHANGE_TIMEOUT_MS = 10_000;
// Per-ATT-packet write size. Web Bluetooth does not expose the negotiated MTU,
// so use a value safe for the standard 247-byte MTU (247 − 3 ATT overhead).
// The mcumgr firmware reassembles a full SMP frame across these fragments.
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
    this.onDisconnected = () => this.rejectAll(new Error("BLE device disconnected"));
    characteristic.addEventListener("characteristicvaluechanged", this.onValueChanged);
    device.addEventListener("gattserverdisconnected", this.onDisconnected);
  }

  private rejectAll(err: Error): void {
    // Snapshot before clearing so the cleanup inside each reject callback
    // doesn't mutate the map while we're iterating it.
    const rejects = [...this.pendingReject.values()];
    this.pending.clear();
    this.pendingReject.clear();
    for (const reject of rejects) reject(err);
  }

  private handleNotification(): void {
    const val = this.characteristic.value;
    if (!val) return;
    // Use byteOffset/byteLength — val.buffer may be a larger shared ArrayBuffer
    // and reading it directly would include bytes outside the notification window.
    const chunk = new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
    const merged = new Uint8Array(this.rxBuf.length + chunk.length);
    merged.set(this.rxBuf);
    merged.set(chunk, this.rxBuf.length);
    this.rxBuf = merged;

    // An SMP frame is complete when we have header + declared payload length.
    while (this.rxBuf.length >= 8) {
      const payloadLen = (this.rxBuf[2] << 8) | this.rxBuf[3];
      const frameLen = 8 + payloadLen;
      if (this.rxBuf.length < frameLen) break;

      const frame = this.rxBuf.slice(0, frameLen);
      this.rxBuf = this.rxBuf.slice(frameLen);

      const seq = frame[6];
      // The stored callback includes cleanup (delete from both maps).
      this.pending.get(seq)?.(frame);
    }
  }

  /** Await the BLE write, then return a Promise for the response notification. */
  async send(
    frame: Uint8Array,
    signal?: AbortSignal
  ): Promise<{ response: Promise<Uint8Array> }> {
    const seq = frame[6];

    const response = new Promise<Uint8Array>((resolve, reject) => {
      // Clean up synchronously inside resolve/reject so the maps are always
      // up-to-date before any microtask runs — prevents close() from finding
      // a stale entry and generating a spurious unhandled rejection.
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
          reject(new Error("SMP: BLE response timeout"));
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

    // An SMP frame can exceed the ATT MTU. The mcumgr BLE transport reassembles
    // a single SMP frame across multiple BLE writes (keyed by the length field),
    // so fragment the frame into MTU-sized ATT packets here. Web Bluetooth does
    // not expose the negotiated MTU, so use a conservative fragment size.
    for (let start = 0; start < frame.length; start += BLE_WRITE_FRAGMENT) {
      const piece = frame.subarray(start, start + BLE_WRITE_FRAGMENT);
      const buf = piece.buffer.slice(
        piece.byteOffset,
        piece.byteOffset + piece.byteLength
      ) as ArrayBuffer;
      await this.writeFragment(buf, seq);
    }
    return { response };
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

  async exchange(frame: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
    const { response } = await this.send(frame, signal);
    return response;
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

/** Connect to the device's SMP GATT service and return a transport. */
async function connectSmpBle(device: BluetoothDevice): Promise<SmpBleTransport> {
  const server = await device.gatt!.connect();
  const service = await server
    .getPrimaryService(SMP_SERVICE_UUID)
    .catch((err: unknown) => {
      if (err instanceof DOMException && err.name === "NotFoundError") {
        throw new Error("firmware.nrf_smp_ble_service_not_found");
      }
      throw err;
    });
  const characteristic = await service.getCharacteristic(SMP_CHARACTERISTIC_UUID);
  await characteristic.startNotifications();
  return new SmpBleTransport(characteristic, device);
}

// ── Install flow ──────────────────────────────────────────────────────────────

async function startNrfSmpBleInstall(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const device = host._device;
  if (!device) return;

  const artifact = await downloadBuildArtifact(
    host,
    device,
    (binaries) => binaries.find((b) => b.file.endsWith("app_update.bin")),
    "firmware.nrf_no_mcuboot_bin"
  );
  if (!artifact) return;

  let info: McubootImageInfo;
  try {
    info = await parseMcubootImageInfo(artifact.bytes);
  } catch (err) {
    if (host._device === device)
      host._fail(host._localize("firmware.nrf_bad_mcuboot_image"), getErrorMessage(err));
    return;
  }

  if (host._device !== device) return;
  nrfSmpBleImage.set(host, { image: artifact.bytes, info });
  host._step = "nrf-smp-ble-ready";
  host._statusMessage = host._localize("firmware.nrf_smp_ble_ready_title");
}

async function nrfDoSmpBleFlash(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const slot = nrfSmpBleImage.get(host);
  if (!slot || host._flashBusy) return;

  const device = host._device;
  const stillCurrent = () => host._device === device && nrfSmpBleImage.get(host) === slot;

  if (!("bluetooth" in navigator)) {
    if (stillCurrent()) host._fail(host._localize("dashboard.logs_ble_nus_unsupported"));
    return;
  }

  const bleDevice = await requestSmpBleDevice([device?.name ?? ""].filter(Boolean));
  if (!bleDevice || !stillCurrent()) return;

  host._step = "flashing";
  host._statusMessage = host._localize("firmware.nrf_smp_connecting");
  host._flashPercent = 0;

  const abort = new AbortController();
  host._flashAbort = abort;
  let transport: SmpBleTransport | undefined;

  const log = installLog(host, stillCurrent);
  try {
    log(`Connecting to ${bleDevice.name ?? "device"} over Bluetooth`);
    transport = await connectSmpBle(bleDevice);
    if (!stillCurrent()) return;
    log("Connected; negotiating transfer parameters");
    host._statusMessage = host._localize("firmware.status_flashing");

    // Speedup comes from a larger chunk size (fewer round-trips), NOT from
    // pipelining: the mcumgr BLE transport handles one SMP request at a time
    // and reassembles by length, so a second request sent before the first is
    // ACK'd corrupts its reassembly buffer. Keep it strictly request→response.
    const params = await smpQueryDeviceParams(transport, abort.signal);
    const chunkSize = params ? chunkSizeFromParams(params) : SMP_CHUNK_SIZE_BLE;
    log(
      params
        ? `Device buffer: ${params.bufSize} bytes × ${params.bufCount}; using ${chunkSize}-byte chunks`
        : `Device did not report parameters; using default ${chunkSize}-byte chunks`
    );

    await smpUploadImage(transport, slot.image, slot.info, chunkSize, {
      signal: abort.signal,
      onProgress: (pct) => {
        if (stillCurrent()) host._flashPercent = pct;
      },
      onLog: log,
    });
  } catch (err) {
    if (stillCurrent()) {
      host._fail(host._localize("firmware.nrf_smp_ble_failed"), getErrorMessage(err));
    }
    return;
  } finally {
    transport?.close();
    if (host._flashAbort === abort) host._flashAbort = null;
  }

  if (!stillCurrent()) return;
  host._statusMessage = host._localize("firmware.status_done");
  host._step = "done";
}

export const nrfSmpBleInstall: BrowserInstall<"nrf-smp-ble"> = {
  id: "nrf-smp-ble",
  methodKey: "nrf_smp_ble",
  holdsPort: false,
  requiresWebSerial: false,
  image: nrfSmpBleImage,
  start: startNrfSmpBleInstall,
  showFirstStep(host) {
    host._step = "nrf-smp-ble-ready";
    host._statusMessage = host._localize("firmware.nrf_smp_ble_ready_title");
  },
  steps: {
    "nrf-smp-ble-ready": {
      detailKey: "firmware.nrf_smp_ble_ready_desc",
      footer: () => ({
        primary: { run: nrfDoSmpBleFlash, labelKey: FLASH_ACTION_KEY },
      }),
    },
  },
};

/** The localize key when the SMP GATT service is not found on the picked device. */
export function smpBleFailureKey(localize: LocalizeFunc, err: unknown): string {
  if (err instanceof Error && err.message === "firmware.nrf_smp_ble_service_not_found") {
    return localize("firmware.nrf_smp_ble_service_not_found");
  }
  return localize("firmware.nrf_smp_ble_failed");
}
