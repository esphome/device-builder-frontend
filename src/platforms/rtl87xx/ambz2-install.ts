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
  pickUf2,
} from "../../components/firmware-install-dialog/browser-flash-steps.js";
import { finishWithLogsPort } from "../../components/firmware-install-dialog/install-flow.js";
import { connectFailureDetail } from "../../util/serial-open-error.js";
import type { HandoffSpec } from "../handoff.js";
import type { LibreTinyImage } from "../libretiny-uf2.js";
import {
  type BrowserInstall,
  FLASH_ACTION_KEY,
  FlashImageSlot,
} from "../platform-support.js";
import { loadAmbz2Image, runAmbz2 } from "./index.js";

declare module "../platform-support.js" {
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
    pickUf2,
    RTL_AMBZ2_HANDOFF.noArtifactKey
  );
  if (!artifact) return;
  const parsed = await loadAmbz2Image(artifact.bytes);
  // Not for a dialog that moved to another device meanwhile.
  if (host._device !== device) return;
  if ("key" in parsed) {
    host._fail(host._localize(parsed.key), parsed.detail);
    return;
  }
  rtlImage.set(host, parsed.image);
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
  const result = await runAmbz2(port, image, {
    signal: abort.signal,
    onLog: installLog(host, stillCurrent),
    onWaiting: () => {
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
  // Without control lines the board is still sitting in the ROM downloader.
  host._statusMessage = host._localize(
    rebooted ? "firmware.status_done" : "firmware.rtl_done_manual_reset"
  );
  // The logs reopen the port with both lines released, so the boot log
  // follows; not while the manual-reset instruction is showing.
  finishWithLogsPort(host, port, { openLogs: rebooted });
}

// The same UF2 the in-app flow parses, handed whole to web.esphome.io's
// rtl-ambz2 engine when this origin cannot flash. The ROM downloader has no
// erase. The platform is also the RTL8710B, whose image this flasher cannot
// write, so the UF2 is parsed here first, as the in-app flow does.
const RTL_AMBZ2_HANDOFF: HandoffSpec = {
  flasher: "rtl-ambz2",
  erase: false,
  pick: pickUf2,
  noArtifactKey: "firmware.no_uf2",
  check: async (bytes) => {
    const parsed = await loadAmbz2Image(bytes);
    return "key" in parsed ? parsed : null;
  },
};

export const rtlAmbz2Install: BrowserInstall<"rtl-ambz2"> = {
  id: "rtl-ambz2",
  methodKey: "rtl_ambz2",
  // The RTL8710B (AmebaZ) is the same platform and another ROM protocol.
  chips: ["rtl8720c"],
  // The logs reopen the flash's port (Show logs on Done, the after-install toggle).
  holdsPort: () => true,
  image: rtlImage,
  start: startRtlAmbz2Install,
  showFirstStep: showReadyStep,
  handoff: RTL_AMBZ2_HANDOFF,
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
