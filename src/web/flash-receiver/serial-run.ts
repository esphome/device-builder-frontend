import type { LocalizeFunc } from "../../common/localize.js";
import { openFailureMessage } from "../../util/serial-open-error.js";
import { requestSerialPort } from "../../util/web-serial.js";
import type { ReceiverNote, ReceiverRun, ReceiverRunHooks } from "./receiver-engine.js";

/**
 * Flash over ``port`` (closed, authorized). Null when it failed; the hooks
 * carried the detail. Never throws.
 */
export type SerialReceiverRun = (
  port: SerialPort,
  hooks: ReceiverRunHooks
) => Promise<{ rebooted: boolean; note?: ReceiverNote } | null>;

/**
 * The run of a flasher that writes over one serial port: the picker, then
 * ``run`` on what it picked, whose port the logs follow.
 */
export function serialRun(localize: LocalizeFunc, run: SerialReceiverRun): ReceiverRun {
  // Nothing is awaited before the port picker: it needs the click's activation.
  return async (hooks) => {
    let port: SerialPort | null;
    try {
      port = await requestSerialPort();
    } catch (err) {
      hooks.onState("error", openFailureMessage(err, localize, "web.flash.no_port"));
      return null;
    }
    if (!port) return "dismissed";

    // Snapshot authorized ports before the flash/reset so the live-log
    // re-acquire can tell the re-enumerated handle from an existing board.
    let knownPorts: SerialPort[] = [];
    try {
      knownPorts = await navigator.serial.getPorts();
    } catch {
      // tolerate; openLiveLogPort falls back to VID/PID matching
    }

    const result = await run(port, hooks);
    return (
      result && {
        note: result.note,
        logs: { port, knownPorts, rebooted: result.rebooted },
      }
    );
  };
}
