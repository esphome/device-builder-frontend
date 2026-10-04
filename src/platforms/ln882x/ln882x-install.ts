/**
 * Lightning LN882H install flow, mirroring the BK72xx one (beken-install.ts):
 * compile, download and parse the LibreTiny UF2, then one user-gesture step
 * that picks the port and flashes through the chip's UART downloader. The
 * engine loads on demand so it stays out of the main chunk.
 */
import { html } from "lit";

import { LIBRETINY_LN882H_FLASHING_URL } from "../../common/docs.js";
import type { ESPHomeFirmwareInstallDialog } from "../../components/firmware-install-dialog.js";
import {
  downloadBuildArtifact,
  installLog,
  pickSerialPortOrFail,
  pickUf2,
} from "../../components/firmware-install-dialog/browser-flash-steps.js";
import { connectFailureDetail } from "../../util/serial-open-error.js";
import type { LibreTinyImage } from "../libretiny-uf2.js";
import {
  type BrowserInstall,
  FLASH_ACTION_KEY,
  FlashImageSlot,
} from "../platform-support.js";
import { loadLn882xImage, runLn882x, warmLn882x } from "./index.js";

declare module "../platform-support.js" {
  interface BrowserFlasherSteps {
    "ln-uart": "ln-ready" | "ln-connect" | "ln-wait";
  }
}

/** The parsed LibreTiny image, kept for Retry. */
export const lnImage = new FlashImageSlot<LibreTinyImage>();

/** Compile, download and parse the UF2, then hand off to the flash step. */
export async function startLn882xInstall(
  host: ESPHomeFirmwareInstallDialog
): Promise<void> {
  const device = host._device;
  if (!device) return;
  const artifact = await downloadBuildArtifact(host, device, pickUf2, "firmware.no_uf2");
  if (!artifact) return;
  const parsed = await loadLn882xImage(artifact.bytes);
  // Not for a dialog that moved to another device meanwhile.
  if (host._device !== device) return;
  if ("key" in parsed) {
    host._fail(host._localize(parsed.key), parsed.detail);
    return;
  }
  lnImage.set(host, parsed.image);
  host._binaries = [artifact.binary];
  // While the user reads on and picks the port; the flash names a failure.
  void warmLn882x().catch(() => {});
  showReadyStep(host);
}

function showReadyStep(host: ESPHomeFirmwareInstallDialog): void {
  host._step = "ln-ready";
  host._statusMessage = host._localize("firmware.ln_ready_title");
}

/**
 * Pick the port and flash. The engine resets the chip into its downloader
 * where the adapter's lines reach it; otherwise the dialog moves to the
 * BOOT guide while the engine keeps polling for the downloader.
 */
export async function lnDoFlash(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const image = lnImage.get(host);
  if (!image || host._flashBusy) return;
  const device = host._device;
  const stillCurrent = () => host._device === device && lnImage.get(host) === image;
  const port = await pickSerialPortOrFail(host, stillCurrent);
  if (!port) return;

  host._step = "ln-connect";
  host._statusMessage = host._localize("firmware.ln_connecting");
  host._flashPercent = 0;
  const abort = new AbortController();
  host._flashAbort = abort;
  const result = await runLn882x(port, image, {
    signal: abort.signal,
    onLog: installLog(host, stillCurrent),
    onWaiting: () => {
      if (!stillCurrent()) return;
      host._step = "ln-wait";
      host._statusMessage = host._localize("firmware.ln_wait_title");
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
      host._localize(result.key ?? "firmware.ln_flash_failed"),
      connectFailureDetail(result.error, host._localize, () => result.detail)
    );
    return;
  }
  // Without a confirmed reboot the chip may still sit in its downloader.
  host._statusMessage = host._localize(
    result.rebooted ? "firmware.status_done" : "firmware.ln_done_manual_reset"
  );
  host._step = "done";
}

export const ln882xInstall: BrowserInstall<"ln-uart"> = {
  id: "ln-uart",
  methodKey: "ln_uart",
  chips: ["ln882h"],
  // The logs stay on the server's serial port for now.
  holdsPort: () => false,
  image: lnImage,
  start: startLn882xInstall,
  showFirstStep: showReadyStep,
  steps: {
    // One click: the engine resets the chip itself, or the BOOT guide shows.
    "ln-ready": {
      detailKey: "firmware.ln_ready_desc",
      footer: () => ({ primary: { run: lnDoFlash, labelKey: FLASH_ACTION_KEY } }),
    },
    "ln-connect": { detailKey: "firmware.ln_connect_desc" },
    // Where to read on when strapping BOOT does not get the chip into its downloader.
    "ln-wait": {
      detailKey: "firmware.ln_wait_desc",
      extra: (host) =>
        html`<a
          class="reset-suggestion-link"
          href=${LIBRETINY_LN882H_FLASHING_URL}
          target="_blank"
          rel="noopener noreferrer"
          >${host._localize("firmware.ln_guide_link")}</a
        >`,
    },
  },
};
