/**
 * The flash receiver's engine for an nRF52 bootloader flashed over its CDC
 * (Adafruit's legacy DFU, Nordic's Secure DFU): the DFU package handed over
 * as one part, a touch into the bootloader as a step of its own for a board
 * that runs firmware, and the flash over the bootloader's port. The two
 * bootloaders differ in what parses, which ports to pick, the copy, and the
 * flash itself.
 */
import type { LocalizeFunc } from "../../../common/localize.js";
import {
  type DfuPackage,
  type DfuPackageFailure,
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
import { PortNotAcceptedError } from "../../../util/web-serial.js";
import type { ReceiverRunHooks } from "../../flash-receiver/receiver-engine.js";
import {
  type ReceiverEngine,
  type ReceiverRun,
  type ReceiverStep,
  singleWholePart,
} from "../../flash-receiver/receiver-engine.js";
import { pickSerialPort } from "../../flash-receiver/serial-run.js";
import { parseFailureCopy } from "../../install/preparation.js";

export interface NrfDfuReceiverSpec {
  /** The package parser, which also refuses what this bootloader cannot take. */
  load: (bytes: Uint8Array) => Promise<{ pkg: DfuPackage } | DfuPackageFailure>;
  /** The step 1 hint, and step 2's title and the note shown while the bootloader comes up. */
  copy: { step1: string; step2Title: string; step2Desc: string };
  /** How to enter the bootloader by hand, on a failed touch or flash. */
  hintKey?: string;
  /** The touch's port, where the application's USB ids are known. */
  touch?: {
    filters: SerialPortRequestOptions["filters"];
    accept: (port: SerialPort) => boolean;
    refusedKey: string;
  };
  /** The flash's port picker, narrowed where the bootloader's USB ids are known. */
  pick?: SerialPortRequestOptions;
  flash: (
    port: SerialPort,
    pkg: DfuPackage,
    hooks: ReceiverRunHooks,
    localize: LocalizeFunc
  ) => Promise<void>;
}

/** The 1200 baud touch into the bootloader, for a board that runs firmware. */
function bootloaderStep(spec: NrfDfuReceiverSpec, localize: LocalizeFunc): ReceiverStep {
  return {
    label: localize(RESET_ACTION_KEY),
    async run(hooks) {
      hooks.onState("connecting", localize("firmware.nrf_resetting"));
      try {
        const touched = await touchIntoBootloader({ onLog: hooks.onLog, ...spec.touch });
        if (!touched) return "dismissed";
      } catch (err) {
        const detail =
          spec.touch && err instanceof PortNotAcceptedError
            ? localize(spec.touch.refusedKey)
            : connectFailureDetail(err, localize, (e) =>
                touchFailureDetail(e, localize, spec.hintKey)
              );
        hooks.onState(
          "error",
          `${localize("firmware.browser_flash_connect_failed")}: ${detail}`
        );
        return null;
      }
      hooks.onState("connecting", localize(spec.copy.step2Title));
      hooks.onWaiting({ message: localize(spec.copy.step2Desc) });
      return null;
    },
  };
}

function dfuRun(
  spec: NrfDfuReceiverSpec,
  pkg: DfuPackage,
  localize: LocalizeFunc
): ReceiverRun {
  return async (hooks) => {
    const port = await pickSerialPort(localize, hooks, spec.pick);
    if (!port || port === "dismissed") return port;
    hooks.onState("installing", localize("firmware.status_flashing"));
    try {
      await spec.flash(port, pkg, hooks, localize);
    } catch (err) {
      hooks.onState(
        "error",
        `${localize("firmware.nrf_flash_failed")}: ${withManualBootloaderHint(err, localize, spec.hintKey)}`
      );
      return null;
    }
    // No logs to follow: the firmware comes back on a port of its own.
    return {};
  };
}

/** The receiver engine for one nRF52 bootloader. */
export function nrfDfuReceiverEngine(spec: NrfDfuReceiverSpec): ReceiverEngine {
  return {
    logs: NRF52_SERIAL_LOGS,
    async prepare(parts, _erase, localize) {
      const zip = singleWholePart(parts);
      const parsed = zip
        ? await spec.load(zip)
        : { key: "firmware.nrf_bad_package", detail: "not a single package part" };
      if ("key" in parsed) {
        // The parser is a chunk of its own; the same bytes can parse next time.
        const { key, retryable } = parseFailureCopy(parsed.key);
        return { error: `${localize(key)} (${parsed.detail})`, retryable };
      }
      return {
        hint: localize(spec.copy.step1),
        primaryLabel: localize(FLASH_ACTION_KEY),
        before: bootloaderStep(spec, localize),
        run: dfuRun(spec, parsed.pkg, localize),
      };
    },
  };
}
