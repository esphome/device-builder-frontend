/**
 * The Device Builder's install for an nRF52 that keeps Nordic's nRF5 SDK
 * bootloader (ESPHome's ``bootloader: nrf``; the nRF52840 Dongle): Secure
 * DFU over the bootloader's CDC. The engine loads on demand so it stays out
 * of the main chunk.
 */
import type { FirmwareBinary } from "../../api/types/firmware-jobs.js";
import type { LocalizeFunc } from "../../common/localize.js";
import type { ESPHomeFirmwareInstallDialog } from "../../components/firmware-install-dialog.js";
import {
  downloadBuildArtifact,
  installLog,
  pickSerialPortOrFail,
  touchIntoBootloaderStep,
} from "../../components/firmware-install-dialog/browser-flash-steps.js";
import { notifyError } from "../../util/notify.js";
import { openFailureMessage } from "../../util/serial-open-error.js";
import { requestSerialPort } from "../../util/web-serial.js";
import { type HandoffSpec, refusalOf } from "../handoff.js";
import {
  type BrowserInstall,
  FLASH_ACTION_KEY,
  type FlasherFooter,
  FlashImageSlot,
  RESET_ACTION_KEY,
} from "../platform-support.js";
import { type DfuPackage, loadDfuPackage, loadSecureDfuEngine } from "./index.js";
import {
  DONGLE_RESET_HINT_KEY,
  touchFailureDetail,
  withManualBootloaderHint,
} from "./manual-bootloader-hint.js";
import {
  isNrfAppCdcPort,
  isOpenDfuBootloaderPort,
  NRF_APP_PORT_FILTER,
  OPEN_DFU_PORT_FILTER,
} from "./nrf-platform.js";

declare module "../platform-support.js" {
  interface BrowserFlasherSteps {
    "nrf-open-dfu": "nrf-open-reset" | "nrf-open-wait";
  }
}

const NO_DFU_PACKAGE_KEY = "firmware.nrf_open_no_dfu_package";
const PORT_REFUSED_KEY = "firmware.nrf_open_port_refused";

const pickDfuPackage = (binaries: FirmwareBinary[]): FirmwareBinary | undefined =>
  binaries.find((b) => b.file.endsWith(".zip"));

// Handed whole to web.esphome.io's nrf-secure-dfu engine; parsed first so a
// bad package is refused before a tab opens. DFU erases what it writes.
const NRF_SECURE_DFU_HANDOFF: HandoffSpec = {
  flasher: "nrf-secure-dfu",
  erase: false,
  pick: pickDfuPackage,
  noArtifactKey: NO_DFU_PACKAGE_KEY,
  check: refusalOf(loadDfuPackage),
};

/** The parsed DFU package, kept for Retry. */
export const nrfOpenPackage = new FlashImageSlot<DfuPackage>();

/**
 * Compile, download and parse the DFU package, then hand off to the two
 * user-gesture steps. Only ESPHome's ``firmware.zip`` (``bootloader: nrf``
 * build) is flashable; MCUboot / hex builds fail here rather than guessing
 * at a raw image.
 */
export async function startNrfOpenDfuInstall(
  host: ESPHomeFirmwareInstallDialog
): Promise<void> {
  const device = host._device;
  if (!device) return;
  const artifact = await downloadBuildArtifact(
    host,
    device,
    pickDfuPackage,
    NO_DFU_PACKAGE_KEY
  );
  if (!artifact) return;
  const stale = () => host._device !== device;

  const parsed = await loadDfuPackage(artifact.bytes);
  if (stale()) return;
  if ("key" in parsed) {
    host._fail(host._localize(parsed.key), parsed.detail);
    return;
  }
  nrfOpenPackage.set(host, parsed.pkg);

  showResetStep(host);
}

// Also the Retry target: the port was released on failure and the device is
// in the bootloader or back in the app, and step 1 handles either.
function showResetStep(host: ESPHomeFirmwareInstallDialog): void {
  host._step = "nrf-open-reset";
  host._statusMessage = host._localize("firmware.nrf_open_step1_title");
  void skipTouchIfInBootloader(host);
}

function showWaitStep(host: ESPHomeFirmwareInstallDialog): void {
  host._step = "nrf-open-wait";
  host._statusMessage = host._localize("firmware.nrf_open_step2_title");
}

/**
 * A board already in its bootloader (factory fresh, or RESET pressed) has no
 * application port to touch: when its bootloader port was granted before
 * and is plugged in, go straight to the flash step.
 */
async function skipTouchIfInBootloader(
  host: ESPHomeFirmwareInstallDialog
): Promise<void> {
  if (!("serial" in navigator)) return;
  const device = host._device;
  const pkg = nrfOpenPackage.get(host);
  let granted: SerialPort[];
  try {
    granted = await navigator.serial.getPorts();
  } catch {
    return;
  }
  const stillHere =
    host._device === device &&
    nrfOpenPackage.get(host) === pkg &&
    host._step === "nrf-open-reset";
  if (!stillHere) return;
  if (granted.some((p) => isOpenDfuBootloaderPort(p) && p.connected !== false)) {
    showWaitStep(host);
  }
}

/**
 * Step 1: the 1200-baud touch on the application's CDC (either of its two
 * ports), which the firmware answers with a pin reset into the bootloader.
 * Runs from a button click (user gesture).
 */
export function nrfOpenDoReset(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  return touchIntoBootloaderStep(host, {
    image: () => nrfOpenPackage.get(host),
    resettingKey: "firmware.nrf_resetting",
    showNext: () => showWaitStep(host),
    failureDetail: (err) =>
      touchFailureDetail(err, host._localize, DONGLE_RESET_HINT_KEY),
    pick: {
      filters: [NRF_APP_PORT_FILTER],
      accept: isNrfAppCdcPort,
      refusedKey: PORT_REFUSED_KEY,
    },
  });
}

/** Step 2: flash over the bootloader's own port. Runs from a button click. */
export async function nrfOpenDoFlash(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const pkg = nrfOpenPackage.get(host);
  if (!pkg || host._flashBusy) return;
  // Teardown aborts the session, but the abort still lands here on a dialog
  // that may already show another install, so only report back to the same
  // one. A retry re-parses, so package identity covers a restart on the same
  // device.
  const device = host._device;
  const stillCurrent = () => host._device === device && nrfOpenPackage.get(host) === pkg;
  const port = await pickSerialPortOrFail(host, stillCurrent, {
    filters: [OPEN_DFU_PORT_FILTER],
  });
  if (!port) return;
  host._step = "flashing";
  host._statusMessage = host._localize("firmware.status_flashing");
  host._flashPercent = 0;
  const abort = new AbortController();
  host._flashAbort = abort;
  try {
    const { flashSecureDfuPackage } = await loadSecureDfuEngine();
    await flashSecureDfuPackage(port, pkg, {
      signal: abort.signal,
      onProgress: (percent) => {
        if (stillCurrent()) host._flashPercent = percent;
      },
      onLog: installLog(host, stillCurrent),
    });
  } catch (err) {
    if (stillCurrent()) {
      host._fail(
        host._localize("firmware.nrf_flash_failed"),
        withManualBootloaderHint(err, host._localize, DONGLE_RESET_HINT_KEY)
      );
    }
    return;
  } finally {
    if (host._flashAbort === abort) host._flashAbort = null;
  }
  if (!stillCurrent()) return;
  host._statusMessage = host._localize("firmware.status_done");
  host._step = "done";
}

/**
 * The logs after the flash: the bootloader started the firmware, which is
 * back as its own USB device, so Show logs picks one of its CDC ports (the
 * second carries the log).
 */
async function pickNrfAppPort(localize: LocalizeFunc): Promise<SerialPort | null> {
  try {
    return await requestSerialPort({ filters: [NRF_APP_PORT_FILTER] });
  } catch (err) {
    notifyError(
      openFailureMessage(err, localize, "dashboard.logs_web_serial_open_failed")
    );
    return null;
  }
}

// Reset stays beside Flash on both steps: every nRF52 running ESPHome
// carries the same USB ids, so a touch that went to another board "succeeds"
// silently, and a device already in its bootloader (factory fresh, or after
// RESET) skips the touch altogether.
function openDfuFooter(): FlasherFooter {
  return {
    secondary: { run: nrfOpenDoReset, labelKey: RESET_ACTION_KEY },
    primary: { run: nrfOpenDoFlash, labelKey: FLASH_ACTION_KEY },
  };
}

/** Two user-gesture steps, each with the touch and the flash a click away. */
export const nrfOpenDfuInstall: BrowserInstall<"nrf-open-dfu"> = {
  id: "nrf-open-dfu",
  methodKey: "nrf_open_dfu",
  bootloaders: ["nrf"],
  holdsPort: () => false,
  image: nrfOpenPackage,
  start: startNrfOpenDfuInstall,
  showFirstStep: showResetStep,
  pickLogsPort: pickNrfAppPort,
  handoff: NRF_SECURE_DFU_HANDOFF,
  steps: {
    "nrf-open-reset": {
      detailKey: "firmware.nrf_open_step1_desc",
      footer: openDfuFooter,
    },
    "nrf-open-wait": { detailKey: "firmware.nrf_open_step2_desc", footer: openDfuFooter },
  },
};
