/**
 * Realtek AmebaZ (RTL8710B) install flow, the RTL8720C one's twin
 * (ambz2-install.ts): compile, download and parse the LibreTiny UF2, then one
 * user-gesture step that picks the port and flashes through the ROM
 * downloader. The engine loads on demand so it stays out of the main chunk.
 */
import { html } from "lit";

import { LIBRETINY_AMBZ_GUIDE_URL } from "../../common/docs.js";
import type { ESPHomeFirmwareInstallDialog } from "../../components/firmware-install-dialog.js";
import {
  downloadBuildArtifact,
  installLog,
  pickSerialPortOrFail,
  pickUf2,
} from "../../components/firmware-install-dialog/browser-flash-steps.js";
import { finishWithLogsPort } from "../../components/firmware-install-dialog/install-flow.js";
import { connectFailureDetail } from "../../util/serial-open-error.js";
import {
  type BrowserInstall,
  FLASH_ACTION_KEY,
  FlashImageSlot,
} from "../platform-support.js";
import type { AmbzImage } from "./ambz-image.js";
import { loadAmbzImage, runAmbz } from "./index.js";

declare module "../platform-support.js" {
  interface BrowserFlasherSteps {
    "rtl-ambz": "rtl-ambz-ready" | "rtl-ambz-connect" | "rtl-ambz-wait";
  }
}

/** The parsed image, kept for Retry. */
export const rtlAmbzImage = new FlashImageSlot<AmbzImage>();

/** Compile, download and parse the UF2, then hand off to the flash step. */
export async function startRtlAmbzInstall(
  host: ESPHomeFirmwareInstallDialog
): Promise<void> {
  const device = host._device;
  if (!device) return;
  const artifact = await downloadBuildArtifact(host, device, pickUf2, "firmware.no_uf2");
  if (!artifact) return;
  const parsed = await loadAmbzImage(artifact.bytes);
  // Not for a dialog that moved to another device meanwhile.
  if (host._device !== device) return;
  if ("key" in parsed) {
    host._fail(host._localize(parsed.key), parsed.detail);
    return;
  }
  rtlAmbzImage.set(host, parsed.image);
  host._binaries = [artifact.binary];
  showReadyStep(host);
}

function showReadyStep(host: ESPHomeFirmwareInstallDialog): void {
  host._step = "rtl-ambz-ready";
  host._statusMessage = host._localize("firmware.rtl_ready_title");
}

/**
 * Pick the port and flash. Unless RTS resets the board into the ROM, the
 * dialog moves to the strap guide while the engine keeps polling for it.
 * The board then needs a reset by hand; its log follows on the same port.
 */
export async function rtlAmbzDoFlash(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const image = rtlAmbzImage.get(host);
  if (!image || host._flashBusy) return;
  const device = host._device;
  const stillCurrent = () => host._device === device && rtlAmbzImage.get(host) === image;
  const port = await pickSerialPortOrFail(host, stillCurrent);
  if (!port) return;

  host._step = "rtl-ambz-connect";
  host._statusMessage = host._localize("firmware.rtl_connecting");
  host._flashPercent = 0;
  const abort = new AbortController();
  host._flashAbort = abort;
  const result = await runAmbz(port, image, {
    signal: abort.signal,
    onLog: installLog(host, stillCurrent),
    onWaiting: () => {
      if (!stillCurrent()) return;
      host._step = "rtl-ambz-wait";
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
  // Not booted (see flashAmbz); the logs open now and show the boot once reset.
  const reset = host._localize("firmware.rtl_ambz_done_reset");
  host._statusMessage = reset;
  finishWithLogsPort(host, port, { notice: reset });
}

export const rtlAmbzInstall: BrowserInstall<"rtl-ambz"> = {
  id: "rtl-ambz",
  methodKey: "rtl_ambz",
  chips: ["rtl8710b"],
  // UART2 is both the flash port and the log port.
  holdsPort: () => true,
  image: rtlAmbzImage,
  start: startRtlAmbzInstall,
  showFirstStep: showReadyStep,
  steps: {
    "rtl-ambz-ready": {
      detailKey: "firmware.rtl_ambz_ready_desc",
      footer: () => ({ primary: { run: rtlAmbzDoFlash, labelKey: FLASH_ACTION_KEY } }),
    },
    "rtl-ambz-connect": { detailKey: "firmware.rtl_ambz_connect_desc" },
    "rtl-ambz-wait": {
      detailKey: "firmware.rtl_ambz_wait_desc",
      extra: (host) =>
        html`<a
          class="reset-suggestion-link"
          href=${LIBRETINY_AMBZ_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          >${host._localize("firmware.rtl_ambz_guide_link")}</a
        >`,
    },
  },
};
