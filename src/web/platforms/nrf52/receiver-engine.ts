/**
 * The flash receiver's nRF52 engine: Nordic legacy DFU over the bootloader's
 * CDC for the DFU package handed over as one part. The board has to be in
 * its bootloader, which is a step of its own for one that runs firmware.
 */
import type { LocalizeFunc } from "../../../common/localize.js";
import {
  type DfuPackage,
  loadDfuEngine,
  loadDfuPackage,
  NRF52_SERIAL_LOGS,
  touchFailureDetail,
  withManualBootloaderHint,
} from "../../../platforms/nrf52/index.js";
import {
  FLASH_ACTION_KEY,
  RESET_ACTION_KEY,
} from "../../../platforms/platform-support.js";
import { touchIntoBootloader } from "../../../util/serial-bootloader-touch.js";
import { connectFailureDetail } from "../../../util/serial-open-error.js";
import {
  type ReceiverEngine,
  type ReceiverRun,
  type ReceiverStep,
  singleWholePart,
} from "../../flash-receiver/receiver-engine.js";
import { pickSerialPort } from "../../flash-receiver/serial-run.js";
import { parseFailureCopy } from "../../install/preparation.js";

/** The 1200 baud touch into the bootloader, for a board that runs firmware. */
function bootloaderStep(localize: LocalizeFunc): ReceiverStep {
  return {
    label: localize(RESET_ACTION_KEY),
    async run(hooks) {
      hooks.onState("connecting", localize("firmware.nrf_resetting"));
      try {
        if (!(await touchIntoBootloader({ onLog: hooks.onLog }))) return "dismissed";
      } catch (err) {
        const detail = connectFailureDetail(err, localize, (e) =>
          touchFailureDetail(e, localize)
        );
        hooks.onState(
          "error",
          `${localize("firmware.browser_flash_connect_failed")}: ${detail}`
        );
        return null;
      }
      hooks.onState("connecting", localize("firmware.nrf_step2_title"));
      hooks.onWaiting({ message: localize("firmware.nrf_step2_desc") });
      return null;
    },
  };
}

function dfuRun(pkg: DfuPackage, localize: LocalizeFunc): ReceiverRun {
  return async (hooks) => {
    const port = await pickSerialPort(localize, hooks);
    if (!port || port === "dismissed") return port;
    hooks.onState("installing", localize("firmware.status_flashing"));
    try {
      // A cache hit: the engine loaded when the package was parsed.
      const { flashDfuPackageWithReconnect } = await loadDfuEngine();
      await flashDfuPackageWithReconnect(port, pkg, {
        onProgress: hooks.onProgress,
        onLog: hooks.onLog,
        onReconnecting: () =>
          hooks.onState("installing", localize("firmware.nrf_reconnecting")),
      });
    } catch (err) {
      hooks.onState(
        "error",
        `${localize("firmware.nrf_flash_failed")}: ${withManualBootloaderHint(err, localize)}`
      );
      return null;
    }
    // No logs to follow: the firmware comes back on a port of its own.
    return {};
  };
}

export const nrfDfuReceiverEngine: ReceiverEngine = {
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
      hint: localize("firmware.nrf_step1_desc"),
      primaryLabel: localize(FLASH_ACTION_KEY),
      before: bootloaderStep(localize),
      run: dfuRun(parsed.pkg, localize),
    };
  },
};
