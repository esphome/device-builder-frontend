/**
 * The flash receiver's engine for an nRF52 with Nordic's nRF5 SDK bootloader
 * (the nRF52840 Dongle): Secure DFU over the bootloader's CDC for the DFU
 * package handed over as one part. The board has to be in its bootloader,
 * which is a step of its own for one that runs firmware.
 */
import type { LocalizeFunc } from "../../../common/localize.js";
import {
  type DfuPackage,
  DONGLE_RESET_HINT_KEY,
  isNrfAppCdcPort,
  loadDfuPackage,
  loadSecureDfuEngine,
  NRF_APP_PORT_FILTER,
  NRF52_SERIAL_LOGS,
  OPEN_DFU_PORT_FILTER,
  touchFailureDetail,
  withManualBootloaderHint,
} from "../../../platforms/nrf52/index.js";
import {
  FLASH_ACTION_KEY,
  RESET_ACTION_KEY,
} from "../../../platforms/platform-support.js";
import { touchIntoBootloader } from "../../../util/serial-bootloader-touch.js";
import { connectFailureDetail } from "../../../util/serial-open-error.js";
import { PortNotAcceptedError } from "../../../util/web-serial.js";
import {
  type ReceiverEngine,
  type ReceiverRun,
  type ReceiverStep,
  singleWholePart,
} from "../../flash-receiver/receiver-engine.js";
import { pickSerialPort } from "../../flash-receiver/serial-run.js";
import { parseFailureCopy } from "../../install/preparation.js";

/**
 * The 1200 baud touch on the application's CDC, which the firmware answers
 * with a pin reset into the bootloader; for a board that runs firmware.
 */
function bootloaderStep(localize: LocalizeFunc): ReceiverStep {
  return {
    label: localize(RESET_ACTION_KEY),
    async run(hooks) {
      hooks.onState("connecting", localize("firmware.nrf_resetting"));
      try {
        const touched = await touchIntoBootloader({
          onLog: hooks.onLog,
          filters: [NRF_APP_PORT_FILTER],
          accept: isNrfAppCdcPort,
        });
        if (!touched) return "dismissed";
      } catch (err) {
        const detail =
          err instanceof PortNotAcceptedError
            ? localize("firmware.nrf_open_port_refused")
            : connectFailureDetail(err, localize, (e) =>
                touchFailureDetail(e, localize, DONGLE_RESET_HINT_KEY)
              );
        hooks.onState(
          "error",
          `${localize("firmware.browser_flash_connect_failed")}: ${detail}`
        );
        return null;
      }
      hooks.onState("connecting", localize("firmware.nrf_open_step2_title"));
      hooks.onWaiting({ message: localize("firmware.nrf_open_step2_desc") });
      return null;
    },
  };
}

function secureDfuRun(pkg: DfuPackage, localize: LocalizeFunc): ReceiverRun {
  return async (hooks) => {
    const port = await pickSerialPort(localize, hooks, {
      filters: [OPEN_DFU_PORT_FILTER],
    });
    if (!port || port === "dismissed") return port;
    hooks.onState("installing", localize("firmware.status_flashing"));
    try {
      const { flashSecureDfuPackage } = await loadSecureDfuEngine();
      await flashSecureDfuPackage(port, pkg, {
        onProgress: hooks.onProgress,
        onLog: hooks.onLog,
      });
    } catch (err) {
      hooks.onState(
        "error",
        `${localize("firmware.nrf_flash_failed")}: ${withManualBootloaderHint(err, localize, DONGLE_RESET_HINT_KEY)}`
      );
      return null;
    }
    // No logs to follow: the firmware comes back on a port of its own.
    return {};
  };
}

export const nrfOpenDfuReceiverEngine: ReceiverEngine = {
  logs: NRF52_SERIAL_LOGS,
  async prepare(parts, _erase, localize) {
    const zip = singleWholePart(parts);
    const parsed = zip
      ? await loadDfuPackage(zip)
      : { key: "firmware.nrf_bad_package", detail: "not a single package part" };
    if ("key" in parsed) {
      // The parser is a chunk of its own; the same bytes can parse next time.
      const { key, retryable } = parseFailureCopy(parsed.key);
      return { error: `${localize(key)} (${parsed.detail})`, retryable };
    }
    return {
      hint: localize("firmware.nrf_open_step1_desc"),
      primaryLabel: localize(FLASH_ACTION_KEY),
      before: bootloaderStep(localize),
      run: secureDfuRun(parsed.pkg, localize),
    };
  },
};
