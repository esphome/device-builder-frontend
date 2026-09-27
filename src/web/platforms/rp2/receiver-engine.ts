/**
 * The flash receiver's Pico engine: the UF2 handed over as one part is
 * written over PICOBOOT, the same engine the in-app flow and the web Pico
 * dialog use. The board has to be in BOOTSEL for it, which is a step of its
 * own for one that runs firmware. Without WebUSB the UF2 is saved instead,
 * to be copied onto the drive.
 */
import type { LocalizeFunc } from "../../../common/localize.js";
import {
  FLASH_ACTION_KEY,
  RESET_ACTION_KEY,
} from "../../../platforms/platform-support.js";
import {
  flashPico,
  isWebUsbSupported,
  loadPicoboot,
  picoFlashFailureCopy,
  RP2_SERIAL_LOGS,
  RP2_SERIAL_PICK,
} from "../../../platforms/rp2/index.js";
import { parsePicoUf2 } from "../../../platforms/rp2/pico-uf2.js";
import { downloadBlob } from "../../../util/download-text.js";
import { getErrorMessage } from "../../../util/error-message.js";
import { touchIntoBootloader } from "../../../util/serial-bootloader-touch.js";
import { connectFailureDetail } from "../../../util/serial-open-error.js";
import type { Uf2Image } from "../../../util/uf2.js";
import { PortNotAcceptedError } from "../../../util/web-serial.js";
import {
  type ReceiverEngine,
  type ReceiverRun,
  type ReceiverStep,
  singleWholePart,
} from "../../flash-receiver/receiver-engine.js";

const UF2_FILENAME = "firmware.uf2";

// The words with WebUSB, and for the drive without it.
const FLASH_COPY = {
  hint: "firmware.rp2_bootsel_desc",
  primary: FLASH_ACTION_KEY,
  wait: "firmware.rp2_wait_desc",
};
const DOWNLOAD_COPY = {
  hint: "firmware.rp2_bootsel_desc_download",
  primary: "firmware.rp2_download_action",
  wait: "firmware.rp2_wait_desc_download",
};

/** The 1200 baud touch into BOOTSEL, for a Pico that runs firmware. */
function bootselStep(localize: LocalizeFunc, waitKey: string): ReceiverStep {
  return {
    label: localize(RESET_ACTION_KEY),
    async run(hooks) {
      hooks.onState("connecting", localize("firmware.rp2_resetting"));
      try {
        const touched = await touchIntoBootloader({
          ...RP2_SERIAL_PICK,
          onLog: hooks.onLog,
        });
        if (!touched) return "dismissed";
      } catch (err) {
        hooks.onState(
          "error",
          err instanceof PortNotAcceptedError
            ? localize("firmware.rp2_not_a_pico")
            : `${localize("firmware.browser_flash_connect_failed")}: ${connectFailureDetail(err, localize)}`
        );
        return null;
      }
      hooks.onState("connecting", localize("firmware.rp2_wait_title"));
      hooks.onWaiting({ message: localize(waitKey) });
      return null;
    },
  };
}

function picobootRun(image: Uf2Image, localize: LocalizeFunc): ReceiverRun {
  return async (hooks) => {
    try {
      const written = await flashPico(image, {
        onDeviceOpened: () =>
          hooks.onState("installing", localize("firmware.status_flashing")),
        onProgress: hooks.onProgress,
        onLog: hooks.onLog,
      });
      // No port to follow: the Pico has none until it has rebooted.
      return written ? {} : "dismissed";
    } catch (err) {
      const { title, detail } = picoFlashFailureCopy(err, localize);
      hooks.onState("error", detail ? `${title}: ${detail}` : title);
      return null;
    }
  };
}

function downloadRun(uf2: Uint8Array, localize: LocalizeFunc): ReceiverRun {
  return async (hooks) => {
    try {
      downloadBlob(
        uf2 as Uint8Array<ArrayBuffer>,
        UF2_FILENAME,
        "application/octet-stream"
      );
    } catch (err) {
      hooks.onState(
        "error",
        `${localize("firmware.download_failed")} ${getErrorMessage(err)}`
      );
      return null;
    }
    return {
      message: localize("firmware.rp2_uf2_download_done_title"),
      note: {
        message: localize("firmware.rp2_uf2_download_done_body", {
          filename: UF2_FILENAME,
        }),
      },
    };
  };
}

export const rp2PicobootReceiverEngine: ReceiverEngine = {
  logs: RP2_SERIAL_LOGS,
  async prepare(parts, _erase, localize) {
    const uf2 = singleWholePart(parts);
    if (!uf2) {
      return { error: `${localize("firmware.rp2_bad_uf2")} (not a single UF2 part)` };
    }
    // Parsed for the download too: a bad file is refused either way.
    const parsed = parsePicoUf2(uf2);
    if ("key" in parsed) return { error: `${localize(parsed.key)} (${parsed.detail})` };
    const usb = isWebUsbSupported();
    // Started with the parse so a failed engine fetch costs nothing later;
    // flashPico names it.
    if (usb) void loadPicoboot().catch(() => {});
    const copy = usb ? FLASH_COPY : DOWNLOAD_COPY;
    return {
      hint: localize(copy.hint),
      primaryLabel: localize(copy.primary),
      before: bootselStep(localize, copy.wait),
      // Each keeps only what it writes: the image, or the file as it came.
      run: usb ? picobootRun(parsed.image, localize) : downloadRun(uf2, localize),
    };
  },
};
