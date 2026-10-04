import type { LocalizeFunc } from "../../common/localize.js";
import type { SerialLogsPolicy } from "../../platforms/serial-logs.js";
import { getErrorMessage } from "../../util/error-message.js";
import { type Prepared, TOOLS_LOAD_FAILED } from "../install/preparation.js";
import type { FlashPart } from "../platforms/esp/firmware-build.js";
import type { HandoffFlasher, HandoffLogs } from "./protocol.js";
import {
  RECEIVER_ENGINES,
  type ReceiverEngine,
  type ReceiverPlan,
  type ReceiverRun,
} from "./receiver-engine.js";

/** What is to be flashed, as it was handed over or picked. */
export interface ReceiverInput {
  parts: FlashPart[];
  erase: boolean;
  flasher: HandoffFlasher;
  logs?: HandoffLogs;
  /** The baud the device logs at, when the opener said. */
  baudRate?: number;
}

/**
 * A checked image: its plan, the logs policy of the flasher that runs it,
 * and the baud the device logs at when the opener said.
 */
export interface ReceiverPrepared extends ReceiverPlan {
  logs: SerialLogsPolicy;
  baudRate?: number;
}

/** ``run``, with no logs to follow it. */
const withoutLogs =
  (run: ReceiverRun): ReceiverRun =>
  async (hooks) => {
    const result = await run(hooks);
    return result && result !== "dismissed" ? { ...result, logs: undefined } : result;
  };

/**
 * Load the flasher's engine and have it check the image. ``pending`` is the
 * input, or what it resolves to when it still has to be read (a picked
 * file); a read that fails rejects with the line to show, and so does this.
 * The failure is that line.
 */
export async function prepareForReceiver(
  pending: ReceiverInput | Promise<ReceiverInput>,
  localize: LocalizeFunc
): Promise<Prepared<ReceiverPrepared, string>> {
  const input = await pending;
  let engine: ReceiverEngine;
  try {
    engine = await RECEIVER_ENGINES[input.flasher]();
  } catch (err) {
    console.error("[flash receiver] Could not load the engine chunk:", err);
    return { failure: localize(TOOLS_LOAD_FAILED), retryable: true };
  }
  try {
    const plan = await engine.prepare(input.parts, input.erase, localize, input.logs);
    if ("error" in plan) {
      return { failure: plan.error, retryable: plan.retryable === true };
    }
    // A device without serial logs has none to open, whichever engine flashed it.
    const run = input.logs === "off" ? withoutLogs(plan.run) : plan.run;
    return { value: { ...plan, run, logs: engine.logs, baudRate: input.baudRate } };
  } catch (err) {
    // An engine broke its never-throws contract: name the image, not the network.
    console.error("[flash receiver] The engine could not check the image:", err);
    return {
      failure: `${localize("web.flash.invalid_image")} (${getErrorMessage(err)})`,
      retryable: false,
    };
  }
}
