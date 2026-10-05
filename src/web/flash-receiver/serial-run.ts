import type { LocalizeFunc } from "../../common/localize.js";
import { openFailureMessage } from "../../util/serial-open-error.js";
import { requestSerialPort } from "../../util/web-serial.js";
import type { ReceiverNote, ReceiverRun, ReceiverRunHooks } from "./receiver-engine.js";

/**
 * Flash over ``port`` (closed, authorized). Null when it failed; the hooks
 * carried the detail. ``logsElsewhere`` when the board does not log on the
 * port it was flashed over; otherwise whether it is booting, for the logs
 * that follow. Never throws.
 */
export type SerialReceiverRun = (
  port: SerialPort,
  hooks: ReceiverRunHooks
) => Promise<
  | ({ note?: ReceiverNote } & (
      { rebooted: boolean; notice?: string } | { logsElsewhere: true }
    ))
  | null
>;

/**
 * The serial port picker, for a run to open first: nothing is awaited before
 * it, as it needs the click's activation. ``"dismissed"`` when it was closed,
 * null when it failed, which the hooks were told.
 */
export async function pickSerialPort(
  localize: LocalizeFunc,
  hooks: ReceiverRunHooks
): Promise<SerialPort | "dismissed" | null> {
  try {
    return (await requestSerialPort()) ?? "dismissed";
  } catch (err) {
    hooks.onState("error", openFailureMessage(err, localize, "web.flash.no_port"));
    return null;
  }
}

/**
 * The run of a flasher that writes over one serial port: the picker, then
 * ``run`` on what it picked, whose port the logs follow unless the board
 * logs elsewhere.
 */
export function serialRun(localize: LocalizeFunc, run: SerialReceiverRun): ReceiverRun {
  return async (hooks) => {
    const port = await pickSerialPort(localize, hooks);
    if (!port || port === "dismissed") return port;

    // Snapshot authorized ports before the flash/reset so the live-log
    // re-acquire can tell the re-enumerated handle from an existing board.
    let knownPorts: SerialPort[] = [];
    try {
      knownPorts = await navigator.serial.getPorts();
    } catch {
      // tolerate; openLiveLogPort falls back to VID/PID matching
    }

    const result = await run(port, hooks);
    if (!result) return null;
    if ("logsElsewhere" in result) return { note: result.note };
    return {
      note: result.note,
      logs: {
        port,
        knownPorts,
        rebooted: result.rebooted,
        notice: result.notice,
      },
    };
  };
}
