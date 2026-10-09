/**
 * Realtek AmebaD (RTL8720D) install flow, the RTL8720C one's twin
 * (ambz2-install.ts): compile, download and parse the LibreTiny UF2, then
 * one user-gesture step that picks the port and flashes through the ROM
 * downloader and the flash loader it is given. The engine loads on demand
 * so it stays out of the main chunk.
 */
import { html } from "lit";

import { LIBRETINY_AMBD_GUIDE_URL } from "../../common/docs.js";
import type { ESPHomeFirmwareInstallDialog } from "../../components/firmware-install-dialog.js";
import {
  downloadBuildArtifact,
  installLog,
  pickSerialPortOrFail,
} from "../../components/firmware-install-dialog/browser-flash-steps.js";
import { finishWithLogsPort } from "../../components/firmware-install-dialog/install-flow.js";
import { connectFailureDetail } from "../../util/serial-open-error.js";
import { refusalOf } from "../handoff.js";
import {
  type BrowserInstall,
  FLASH_ACTION_KEY,
  FlashImageSlot,
} from "../platform-support.js";
import { NO_UF2_KEY, pickUf2, uf2Handoff } from "../uf2-handoff.js";
import type { AmbdImage } from "./ambd-image.js";
import { checkAmbdImage, loadAmbdImage, runAmbd, warmAmbd } from "./index.js";

declare module "../platform-support.js" {
  interface BrowserFlasherSteps {
    "rtl-ambd": "rtl-ambd-ready" | "rtl-ambd-connect" | "rtl-ambd-wait";
  }
}

/** The parsed image, kept for Retry. */
export const rtlAmbdImage = new FlashImageSlot<AmbdImage>();

/** Compile, download and parse the UF2, then hand off to the flash step. */
export async function startRtlAmbdInstall(
  host: ESPHomeFirmwareInstallDialog
): Promise<void> {
  const device = host._device;
  if (!device) return;
  const artifact = await downloadBuildArtifact(host, device, pickUf2, NO_UF2_KEY);
  if (!artifact) return;
  const parsed = await loadAmbdImage(artifact.bytes);
  // Not for a dialog that moved to another device meanwhile.
  if (host._device !== device) return;
  if ("key" in parsed) {
    host._fail(host._localize(parsed.key), parsed.detail);
    return;
  }
  rtlAmbdImage.set(host, parsed.image);
  host._binaries = [artifact.binary];
  // The engine and the flash loader download while the user reads the step.
  void warmAmbd().catch(() => {});
  showReadyStep(host);
}

function showReadyStep(host: ESPHomeFirmwareInstallDialog): void {
  host._step = "rtl-ambd-ready";
  host._statusMessage = host._localize("firmware.rtl_ready_title");
}

/**
 * Pick the port and flash. The engine resets the board into download mode
 * by itself where the adapter's control lines allow it; otherwise the dialog
 * moves to the strap guide while the engine keeps polling for the ROM.
 */
export async function rtlAmbdDoFlash(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const image = rtlAmbdImage.get(host);
  if (!image || host._flashBusy) return;
  const device = host._device;
  const stillCurrent = () => host._device === device && rtlAmbdImage.get(host) === image;
  const port = await pickSerialPortOrFail(host, stillCurrent);
  if (!port) return;

  host._step = "rtl-ambd-connect";
  host._statusMessage = host._localize("firmware.rtl_connecting");
  host._flashPercent = 0;
  const abort = new AbortController();
  host._flashAbort = abort;
  const result = await runAmbd(port, image, {
    signal: abort.signal,
    onLog: installLog(host, stillCurrent),
    onWaiting: () => {
      if (!stillCurrent()) return;
      host._step = "rtl-ambd-wait";
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
  if (host._flashAbort === abort) host._flashAbort = null;
  if (!stillCurrent()) return;
  if ("detail" in result) {
    host._fail(
      host._localize(result.key ?? "firmware.rtl_flash_failed"),
      connectFailureDetail(result.error, host._localize, () => result.detail)
    );
    return;
  }
  const { rebooted } = result;
  // Without control lines the board is still sitting in the flash loader.
  host._statusMessage = host._localize(
    rebooted ? "firmware.status_done" : "firmware.rtl_ambd_done_manual_reset"
  );
  // The logs reopen the port with both lines released, so the boot log
  // follows; not while the manual-reset instruction is showing.
  finishWithLogsPort(host, port, { openLogs: rebooted });
}

// The platform is also the RTL8720C and RTL8710B, whose images this flasher cannot write.
const RTL_AMBD_HANDOFF = uf2Handoff("rtl-ambd", refusalOf(checkAmbdImage));

export const rtlAmbdInstall: BrowserInstall<"rtl-ambd"> = {
  id: "rtl-ambd",
  methodKey: "rtl_ambd",
  chips: ["rtl8720d"],
  // LOG_UART is both the flash port and the log port.
  holdsPort: () => true,
  image: rtlAmbdImage,
  start: startRtlAmbdInstall,
  showFirstStep: showReadyStep,
  handoff: RTL_AMBD_HANDOFF,
  steps: {
    // One click: the engine resets the board itself, or shows the strap guide.
    "rtl-ambd-ready": {
      detailKey: "firmware.rtl_ambd_ready_desc",
      footer: () => ({ primary: { run: rtlAmbdDoFlash, labelKey: FLASH_ACTION_KEY } }),
    },
    "rtl-ambd-connect": { detailKey: "firmware.rtl_ambd_connect_desc" },
    // Where to read on when the strap step does not get the board into download mode.
    "rtl-ambd-wait": {
      detailKey: "firmware.rtl_ambd_wait_desc",
      extra: (host) =>
        html`<a
          class="reset-suggestion-link"
          href=${LIBRETINY_AMBD_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          >${host._localize("firmware.rtl_ambd_guide_link")}</a
        >`,
    },
  },
};
