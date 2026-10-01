/**
 * The Device Builder's MCUboot installs for nRF52: an update over the mcumgr
 * SMP service the running firmware exposes, by Bluetooth or serial. The
 * engine loads on demand so it stays out of the main chunk.
 */
import type { ESPHomeFirmwareInstallDialog } from "../../components/firmware-install-dialog.js";
import {
  downloadBuildArtifact,
  installLog,
  pickSerialPortOrFail,
} from "../../components/firmware-install-dialog/browser-flash-steps.js";
import { getErrorMessage } from "../../util/error-message.js";
import {
  type BrowserInstall,
  FLASH_ACTION_KEY,
  FlashImageSlot,
} from "../platform-support.js";
import { pickBleDevice } from "./ble-nus-picker.js";
import { isWebBluetoothSupported } from "./ble-nus-stream.js";
import {
  loadMcubootImage,
  loadSmpEngine,
  type McubootImage,
  type SmpUploadHooks,
} from "./index.js";
import { SMP_BLE_SERVICE_UUID } from "./smp-ble-service.js";

declare module "../platform-support.js" {
  interface BrowserFlasherSteps {
    "nrf-smp-ble": "nrf-smp-ble-ready";
    "nrf-smp-serial": "nrf-smp-serial-ready";
  }
}

// The ``ota:`` platform that puts the SMP service on the device.
const MCUMGR_OTA = "ota.zephyr_mcumgr";

type SmpEngine = Awaited<ReturnType<typeof loadSmpEngine>>;
type SmpStep = "nrf-smp-ble-ready" | "nrf-smp-serial-ready";

interface SmpFlow {
  readonly image: FlashImageSlot<McubootImage>;
  readonly readyStep: SmpStep;
  readonly readyTitleKey: string;
  readonly failedKey: string;
}

function showReady(host: ESPHomeFirmwareInstallDialog, flow: SmpFlow): void {
  host._step = flow.readyStep;
  host._statusMessage = host._localize(flow.readyTitleKey);
}

/** Compile, download and validate the update image, then show the ready step. */
async function startSmpInstall(
  host: ESPHomeFirmwareInstallDialog,
  flow: SmpFlow
): Promise<void> {
  const device = host._device;
  if (!device) return;
  const artifact = await downloadBuildArtifact(
    host,
    device,
    (binaries) => binaries.find((b) => b.file.endsWith("app_update.bin")),
    "firmware.nrf_no_mcuboot_bin"
  );
  if (!artifact) return;
  const loaded = await loadMcubootImage(artifact.bytes);
  if (host._device !== device) return;
  if ("key" in loaded) {
    host._fail(host._localize(loaded.key), loaded.detail);
    return;
  }
  flow.image.set(host, loaded.image);
  showReady(host, flow);
}

/** The title and the detail of a failed upload. */
function smpFailure(
  host: ESPHomeFirmwareInstallDialog,
  flow: SmpFlow,
  engine: SmpEngine | undefined,
  err: unknown
): [title: string, detail: string] {
  const detail = getErrorMessage(err);
  if (!engine) return [host._localize("firmware.engine_load_failed"), detail];
  if (err instanceof engine.SmpBleServiceNotFoundError) {
    return [host._localize("firmware.nrf_smp_ble_service_not_found"), detail];
  }
  if (err instanceof engine.SmpRestartNeededError) {
    return [
      host._localize("firmware.nrf_smp_restart_needed_title"),
      host._localize("firmware.nrf_smp_restart_needed"),
    ];
  }
  return [
    host._localize(flow.failedKey),
    engine.isSerialDeviceLost(err) ? host._localize("serial.device_lost") : detail,
  ];
}

/**
 * The upload, from a footer click: ``pick`` opens the chooser (null when
 * there is nothing to flash), ``flash`` runs the engine over what it picked.
 */
async function runSmpFlash<Target>(
  host: ESPHomeFirmwareInstallDialog,
  flow: SmpFlow,
  pick: (stillCurrent: () => boolean) => Promise<Target | null>,
  flash: (
    engine: SmpEngine,
    target: Target,
    image: McubootImage,
    hooks: SmpUploadHooks
  ) => Promise<void>
): Promise<void> {
  const image = flow.image.get(host);
  if (!image || host._flashBusy) return;
  // The abort still lands here on a dialog that may already show another
  // install, so only report back to the same one.
  const device = host._device;
  const stillCurrent = () => host._device === device && flow.image.get(host) === image;
  const target = await pick(stillCurrent);
  if (target === null || !stillCurrent()) return;

  host._step = "flashing";
  host._statusMessage = host._localize("firmware.status_flashing");
  host._flashPercent = 0;
  const abort = new AbortController();
  host._flashAbort = abort;
  let engine: SmpEngine | undefined;
  try {
    // A cache hit: the engine loaded when the image was parsed.
    engine = await loadSmpEngine();
    await flash(engine, target, image, {
      signal: abort.signal,
      onProgress: (percent) => {
        if (stillCurrent()) host._flashPercent = percent;
      },
      onLog: installLog(host, stillCurrent),
    });
  } catch (err) {
    if (stillCurrent()) {
      host._fail(...smpFailure(host, flow, engine, err));
    }
    return;
  } finally {
    if (host._flashAbort === abort) host._flashAbort = null;
  }
  if (!stillCurrent()) return;
  host._statusMessage = host._localize("firmware.status_done");
  host._step = "done";
}

const bleFlow: SmpFlow = {
  image: new FlashImageSlot<McubootImage>(),
  readyStep: "nrf-smp-ble-ready",
  readyTitleKey: "firmware.nrf_smp_ble_ready_title",
  failedKey: "firmware.nrf_smp_ble_failed",
};

const serialFlow: SmpFlow = {
  image: new FlashImageSlot<McubootImage>(),
  readyStep: "nrf-smp-serial-ready",
  readyTitleKey: "firmware.nrf_smp_serial_ready_title",
  failedKey: "firmware.nrf_smp_serial_failed",
};

const flashOverBle = (host: ESPHomeFirmwareInstallDialog): Promise<void> =>
  runSmpFlash(
    host,
    bleFlow,
    () => pickBleDevice(host._localize, [], SMP_BLE_SERVICE_UUID, [SMP_BLE_SERVICE_UUID]),
    (engine, device, image, hooks) => engine.flashMcubootOverBle(device, image, hooks)
  );

const flashOverSerial = (host: ESPHomeFirmwareInstallDialog): Promise<void> =>
  runSmpFlash(
    host,
    serialFlow,
    (stillCurrent) => pickSerialPortOrFail(host, stillCurrent),
    (engine, port, image, hooks) => engine.flashMcubootOverSerial(port, image, hooks)
  );

export const nrfSmpBleInstall: BrowserInstall<"nrf-smp-ble"> = {
  id: "nrf-smp-ble",
  methodKey: "nrf_smp_ble",
  component: MCUMGR_OTA,
  available: isWebBluetoothSupported,
  icon: "bluetooth",
  holdsPort: () => false,
  image: bleFlow.image,
  start: (host) => startSmpInstall(host, bleFlow),
  showFirstStep: (host) => showReady(host, bleFlow),
  steps: {
    "nrf-smp-ble-ready": {
      detailKey: "firmware.nrf_smp_ble_ready_desc",
      footer: () => ({ primary: { run: flashOverBle, labelKey: FLASH_ACTION_KEY } }),
    },
  },
};

export const nrfSmpSerialInstall: BrowserInstall<"nrf-smp-serial"> = {
  id: "nrf-smp-serial",
  methodKey: "nrf_smp_serial",
  component: MCUMGR_OTA,
  advanced: true,
  holdsPort: () => false,
  image: serialFlow.image,
  start: (host) => startSmpInstall(host, serialFlow),
  showFirstStep: (host) => showReady(host, serialFlow),
  steps: {
    "nrf-smp-serial-ready": {
      detailKey: "firmware.nrf_smp_serial_ready_desc",
      footer: () => ({ primary: { run: flashOverSerial, labelKey: FLASH_ACTION_KEY } }),
    },
  },
};
