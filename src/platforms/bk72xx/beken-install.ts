/**
 * Beken BK72xx install flow, mirroring the RTL8720C one (ambz2-install.ts):
 * compile, download and parse the LibreTiny UF2, then one user-gesture step
 * that picks the port and flashes through the chip's UART downloader. The
 * engine loads on demand so it stays out of the main chunk.
 */
import { html } from "lit";

import { LIBRETINY_BEKEN_GUIDE_URL } from "../../common/docs.js";
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
import { loadBekenImage, runBeken } from "./index.js";
import {
  BK_LOGS_ON_FLASH_PORT_SETTING,
  bkHandoffLogs,
  bkLogsOnFlashPort,
} from "./serial-logs.js";

declare module "../platform-support.js" {
  interface BrowserFlasherSteps {
    "bk-uart": "bk-ready" | "bk-connect" | "bk-wait";
  }
}

/** The parsed LibreTiny image, kept for Retry. */
export const bekenImage = new FlashImageSlot<LibreTinyImage>();

/** Compile, download and parse the UF2, then hand off to the flash step. */
export async function startBekenInstall(
  host: ESPHomeFirmwareInstallDialog
): Promise<void> {
  const device = host._device;
  if (!device) return;
  const artifact = await downloadBuildArtifact(
    host,
    device,
    pickUf2,
    BK_UART_HANDOFF.noArtifactKey
  );
  if (!artifact) return;
  const parsed = await loadBekenImage(artifact.bytes);
  // Not for a dialog that moved to another device meanwhile.
  if (host._device !== device) return;
  if ("key" in parsed) {
    host._fail(host._localize(parsed.key), parsed.detail);
    return;
  }
  bekenImage.set(host, parsed.image);
  host._binaries = [artifact.binary];
  showReadyStep(host);
}

function showReadyStep(host: ESPHomeFirmwareInstallDialog): void {
  host._step = "bk-ready";
  host._statusMessage = host._localize("firmware.bk_ready_title");
}

/**
 * Pick the port and flash. A chip that runs ESPHome enters its downloader
 * by itself, and the engine resets one whose adapter's lines reach it;
 * otherwise the dialog moves to the reset guide while the engine keeps
 * polling for the downloader.
 */
export async function bekenDoFlash(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const image = bekenImage.get(host);
  if (!image || host._flashBusy) return;
  const device = host._device;
  const stillCurrent = () => host._device === device && bekenImage.get(host) === image;
  const port = await pickSerialPortOrFail(host, stillCurrent);
  if (!port) return;

  host._step = "bk-connect";
  host._statusMessage = host._localize("firmware.bk_connecting");
  host._flashPercent = 0;
  const abort = new AbortController();
  host._flashAbort = abort;
  const result = await runBeken(port, image, {
    signal: abort.signal,
    onLog: installLog(host, stillCurrent),
    onWaiting: () => {
      if (!stillCurrent()) return;
      host._step = "bk-wait";
      host._statusMessage = host._localize("firmware.bk_wait_title");
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
      host._localize(result.key ?? "firmware.bk_flash_failed"),
      connectFailureDetail(result.error, host._localize, () => result.detail)
    );
    return;
  }
  // The adapter is on UART1, so the logs follow only a config that moved
  // them there; a disabled logger has none to point at.
  if (bkLogsOnFlashPort(device)) {
    host._statusMessage = host._localize("firmware.status_done");
    finishWithLogsPort(host, port);
    return;
  }
  host._statusMessage =
    device?.logger_baud_rate === 0
      ? host._localize("firmware.status_done")
      : host._localize("firmware.bk_done_logs_on_uart2", {
          setting: BK_LOGS_ON_FLASH_PORT_SETTING,
        });
  host._step = "done";
}

// The same UF2 the in-app flow parses, handed whole to web.esphome.io's
// bk-uart engine when this origin cannot flash. The downloader erases sector
// by sector as it writes. The UF2 is parsed here first, as the in-app flow
// does, so that a build that is not Beken's is named before the tab opens.
const BK_UART_HANDOFF: HandoffSpec = {
  flasher: "bk-uart",
  erase: false,
  pick: pickUf2,
  noArtifactKey: "firmware.no_uf2",
  check: async (bytes) => {
    const parsed = await loadBekenImage(bytes);
    return "key" in parsed ? parsed : null;
  },
  logs: bkHandoffLogs,
};

export const bekenInstall: BrowserInstall<"bk-uart"> = {
  id: "bk-uart",
  methodKey: "bk_uart",
  chips: ["bk7231", "bk7238", "bk7251"],
  // The flash goes over UART1; the logs are on that port only when the
  // config moves them there from UART2.
  holdsPort: bkLogsOnFlashPort,
  image: bekenImage,
  start: startBekenInstall,
  showFirstStep: showReadyStep,
  handoff: BK_UART_HANDOFF,
  steps: {
    // One click: the chip enters its downloader by itself, or the guide shows.
    "bk-ready": {
      detailKey: "firmware.bk_ready_desc",
      footer: () => ({ primary: { run: bekenDoFlash, labelKey: FLASH_ACTION_KEY } }),
    },
    "bk-connect": { detailKey: "firmware.bk_connect_desc" },
    // Where to read on when the reset does not get the chip into its downloader.
    "bk-wait": {
      detailKey: "firmware.bk_wait_desc",
      extra: (host) =>
        html`<a
          class="reset-suggestion-link"
          href=${LIBRETINY_BEKEN_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          >${host._localize("firmware.bk_guide_link")}</a
        >`,
    },
  },
};
