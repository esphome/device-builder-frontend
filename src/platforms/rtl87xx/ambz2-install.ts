/**
 * Realtek AmebaZ2 (rtl87xx) install flow, mirroring the Pico one (uf2-install.ts):
 * compile, download and parse the LibreTiny UF2, then one user-gesture step
 * that picks the port and flashes through the ROM downloader. The engine
 * loads on demand so it stays out of the main chunk.
 */
import { html } from "lit";

import { LIBRETINY_AMBZ2_GUIDE_URL } from "../../common/docs.js";
import type { ESPHomeFirmwareInstallDialog } from "../../components/firmware-install-dialog.js";
import {
  downloadBuildArtifact,
  installLog,
  pickSerialPortOrFail,
} from "../../components/firmware-install-dialog/browser-flash-steps.js";
import {
  type BrowserFlasher,
  FLASH_ACTION_KEY,
  FlashImageSlot,
} from "../../components/firmware-install-dialog/browser-flasher.js";
import { finishWithLogsPort } from "../../components/firmware-install-dialog/install-flow.js";
import { getErrorMessage } from "../../util/error-message.js";
import { loadAmbz2Engine } from "./index.js";
import {
  Ambz2ImageError,
  type LibreTinyImage,
  parseAmbz2Image,
} from "./libretiny-uf2.js";
import { isRtl87xxPlatform } from "./rtl87xx-platform.js";

declare module "../../components/firmware-install-dialog/types.js" {
  interface BrowserFlasherSteps {
    "rtl-ambz2": "rtl-ready" | "rtl-connect" | "rtl-wait";
  }
}

/** The parsed LibreTiny image, kept for Retry. */
export const rtlImage = new FlashImageSlot<LibreTinyImage>();

/** Compile, download and parse the UF2, then hand off to the flash step. */
export async function startRtlAmbz2Install(
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
    rtlImage.set(host, parseAmbz2Image(artifact.bytes));
  } catch (err) {
    host._fail(
      host._localize(err instanceof Ambz2ImageError ? err.key : "firmware.rtl_bad_uf2"),
      getErrorMessage(err)
    );
    return;
  }
  host._binaries = [artifact.binary];
  showReadyStep(host);
}

function showReadyStep(host: ESPHomeFirmwareInstallDialog): void {
  host._step = "rtl-ready";
  host._statusMessage = host._localize("firmware.rtl_ready_title");
}

/**
 * Pick the port and flash. The engine resets the board into download mode
 * by itself where the adapter's control lines allow it; otherwise the dialog
 * moves to the strap guide while the engine keeps polling for the ROM.
 */
export async function rtlDoFlash(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const image = rtlImage.get(host);
  if (!image || host._flashBusy) return;
  const device = host._device;
  const stillCurrent = () => host._device === device && rtlImage.get(host) === image;
  const port = await pickSerialPortOrFail(host, stillCurrent);
  if (!port) return;

  host._step = "rtl-connect";
  host._statusMessage = host._localize("firmware.rtl_connecting");
  host._flashPercent = 0;
  const abort = new AbortController();
  host._flashAbort = abort;
  let rebooted: boolean;
  try {
    const { flashAmbz2 } = await loadAmbz2Engine();
    rebooted = await flashAmbz2(port, image, {
      signal: abort.signal,
      onLog: installLog(host, stillCurrent),
      onWaitingForStrap: () => {
        if (!stillCurrent()) return;
        host._step = "rtl-wait";
        host._statusMessage = host._localize("firmware.rtl_wait_title");
      },
      onLinked: () => {
        if (!stillCurrent()) return;
        host._step = "flashing";
        host._statusMessage = host._localize("firmware.status_flashing");
      },
      onProgress: (percent) => {
        if (stillCurrent()) host._flashPercent = percent;
      },
    });
  } catch (err) {
    if (stillCurrent()) {
      host._fail(host._localize("firmware.rtl_flash_failed"), getErrorMessage(err));
    }
    return;
  } finally {
    if (host._flashAbort === abort) host._flashAbort = null;
  }
  if (!stillCurrent()) return;
  // Without control lines the board is still sitting in the ROM downloader.
  host._statusMessage = host._localize(
    rebooted ? "firmware.status_done" : "firmware.rtl_done_manual_reset"
  );
  // The logs reopen the port with both lines released, so the boot log
  // follows; not while the manual-reset instruction is showing.
  finishWithLogsPort(host, port, rebooted);
}

export const rtlAmbz2Flasher: BrowserFlasher<"rtl-ambz2"> = {
  id: "rtl-ambz2",
  matches: isRtl87xxPlatform,
  methodKey: "rtl_ambz2",
  // The logs reopen the flash's port (Show logs on Done, the after-install toggle).
  holdsPort: true,
  start: startRtlAmbz2Install,
  showFirstStep: showReadyStep,
  steps: {
    // One click: the engine resets the board itself, or shows the strap guide.
    "rtl-ready": {
      detailKey: "firmware.rtl_ready_desc",
      footer: () => ({ primary: { run: rtlDoFlash, labelKey: FLASH_ACTION_KEY } }),
    },
    "rtl-connect": { detailKey: "firmware.rtl_connect_desc" },
    // Where to read on when the strap step does not get the board into download mode.
    "rtl-wait": {
      detailKey: "firmware.rtl_wait_desc",
      extra: (host) =>
        html`<a
          class="reset-suggestion-link"
          href=${LIBRETINY_AMBZ2_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          >${host._localize("firmware.rtl_guide_link")}</a
        >`,
    },
  },
};
