/**
 * Raspberry Pi Pico (rp2) install flow, mirroring the nRF52 one (dfu-install.ts):
 * compile, download and parse the UF2, then two user-gesture steps. The
 * PICOBOOT engine loads on demand so it stays out of the main chunk.
 */
import type { ESPHomeFirmwareInstallDialog } from "../../components/firmware-install-dialog.js";
import {
  downloadBuildArtifact,
  installLog,
  touchIntoBootloaderStep,
} from "../../components/firmware-install-dialog/browser-flash-steps.js";
import { downloadSelectedBinary } from "../../components/firmware-install-dialog/install-flow.js";
import { getErrorMessage } from "../../util/error-message.js";
import {
  parseUf2Image,
  UF2_FAMILY_RP2040,
  UF2_FAMILY_RP2350_ARM_S,
  Uf2FamilyError,
  type Uf2Image,
} from "../../util/uf2.js";
import {
  type BrowserInstall,
  FLASH_ACTION_KEY,
  type FlasherFooter,
  FlashImageSlot,
  RESET_ACTION_KEY,
} from "../platform-support.js";
import { flashPico, PicoFlashError, picoFlashFailureCopy } from "./rp2-flash.js";
import { isWebUsbSupported } from "./web-usb.js";

declare module "../platform-support.js" {
  interface BrowserFlasherSteps {
    "rp2-uf2": "rp2-bootsel" | "rp2-wait";
  }
}

/** The parsed UF2, kept for Retry. */
export const rp2Image = new FlashImageSlot<Uf2Image>();

/**
 * Compile, download and parse the UF2, then hand off to the BOOTSEL step.
 * Only RP2040 images are flashable here; an RP2350 UF2 is refused up front.
 */
export async function startRp2Uf2Install(
  host: ESPHomeFirmwareInstallDialog
): Promise<void> {
  const device = host._device;
  if (!device) return;
  const artifact = await downloadBuildArtifact(
    host,
    device,
    (b) => b.type === "uf2",
    "firmware.no_uf2"
  );
  if (!artifact) return;
  try {
    rp2Image.set(host, parseUf2Image(artifact.bytes, [UF2_FAMILY_RP2040]));
  } catch (err) {
    // Only a real RP2350 image gets the copy-to-drive advice; a missing or
    // unknown family is just a bad file.
    const rp2350 =
      err instanceof Uf2FamilyError && err.familyId === UF2_FAMILY_RP2350_ARM_S;
    host._fail(
      host._localize(rp2350 ? "firmware.rp2_rp2350_unsupported" : "firmware.rp2_bad_uf2"),
      getErrorMessage(err)
    );
    return;
  }
  // The only artifact this flow hands out; the download step reads it from here.
  host._binaries = [artifact.binary];
  showBootselStep(host);
}

function showBootselStep(host: ESPHomeFirmwareInstallDialog): void {
  host._step = "rp2-bootsel";
  host._statusMessage = host._localize("firmware.rp2_bootsel_title");
}

/** Step 1: 1200-baud touch into BOOTSEL. Runs from a button click (user gesture). */
export function rp2DoReset(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  return touchIntoBootloaderStep(host, {
    image: () => rp2Image.get(host),
    resettingKey: "firmware.rp2_resetting",
    showNext: () => {
      host._step = "rp2-wait";
      host._statusMessage = host._localize("firmware.rp2_wait_title");
    },
  });
}

/** Step 2 with WebUSB: pick the RP2 Boot device and write over PICOBOOT. */
export async function rp2DoFlash(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const image = rp2Image.get(host);
  if (!image || host._flashBusy) return;
  const device = host._device;
  const stillCurrent = () => host._device === device && rp2Image.get(host) === image;
  host._flashBusy = true;
  const abort = new AbortController();
  host._flashAbort = abort;
  let flashed: boolean;
  try {
    flashed = await flashPico(image, {
      signal: abort.signal,
      cancelled: () => !stillCurrent(),
      onLog: installLog(host, stillCurrent),
      onDeviceOpened: () => {
        // The chooser is done; the write runs with the step shown.
        host._flashBusy = false;
        host._step = "flashing";
        host._statusMessage = host._localize("firmware.status_flashing");
        host._flashPercent = 0;
      },
      onProgress: (percent) => {
        if (stillCurrent()) host._flashPercent = percent;
      },
    });
  } catch (err) {
    if (!stillCurrent()) return;
    if (err instanceof PicoFlashError) {
      const { title, detail } = picoFlashFailureCopy(err, host._localize);
      host._fail(title, detail);
    } else {
      host._fail(host._localize("firmware.rp2_flash_failed"), getErrorMessage(err));
    }
    return;
  } finally {
    if (stillCurrent()) host._flashBusy = false;
    if (host._flashAbort === abort) host._flashAbort = null;
  }
  if (!flashed || !stillCurrent()) return;
  host._statusMessage = host._localize("firmware.status_done");
  host._step = "done";
}

/** Step 2 without WebUSB: save the UF2 for a manual copy onto the RPI-RP2 drive. */
export function rp2DoDownload(host: ESPHomeFirmwareInstallDialog): void {
  const file = host._binaries[0]?.file;
  if (!file || host._flashBusy) return;
  void downloadSelectedBinary(host, file);
}

// Reset stays beside the write on both steps: a touch on the wrong serial
// port "succeeds" silently, and a blank Pico skips it. Without WebUSB the
// write is a UF2 download the user copies to the drive.
function bootselFooter(): FlasherFooter {
  return {
    secondary: { run: rp2DoReset, labelKey: RESET_ACTION_KEY },
    primary: isWebUsbSupported()
      ? { run: rp2DoFlash, labelKey: FLASH_ACTION_KEY }
      : { run: rp2DoDownload, labelKey: "firmware.rp2_download_action" },
  };
}

const withoutWebUsb = (key: string) => () =>
  isWebUsbSupported() ? key : `${key}_download`;

export const rp2Uf2Install: BrowserInstall<"rp2-uf2"> = {
  id: "rp2-uf2",
  methodKey: "rp2_uf2",
  holdsPort: false,
  image: rp2Image,
  start: startRp2Uf2Install,
  showFirstStep: showBootselStep,
  steps: {
    "rp2-bootsel": {
      detailKey: withoutWebUsb("firmware.rp2_bootsel_desc"),
      footer: bootselFooter,
    },
    "rp2-wait": {
      detailKey: withoutWebUsb("firmware.rp2_wait_desc"),
      footer: bootselFooter,
    },
  },
  downloadReady: {
    titleKey: "firmware.rp2_uf2_download_done_title",
    bodyKey: "firmware.rp2_uf2_download_done_body",
  },
};
