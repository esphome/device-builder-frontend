import { platformReset, type SerialLogsPolicy } from "../../platforms/serial-logs.js";
import { sleep } from "../../util/sleep.js";

/**
 * How the web logs run a board's Reset device. Each card hands its family's
 * shared ``SerialLogsPolicy`` (``src/platforms/<name>/``) to both the port
 * open and the logs dialog; this maps its reset onto the dialog's two paths.
 */
export interface WebSerialReset {
  /**
   * The reset re-enumerates the port (a platform's own reboot), so the
   * stream is dropped first and resumed after.
   */
  readonly dropsStream: boolean;
  run(port: SerialPort, cancelled: () => boolean): Promise<void>;
}

/**
 * Pulse RTS to reboot the running app so the user can capture boot logs,
 * matching legacy ewt-console.reset(): RTS high then low back-to-back, then a
 * 1s settle for the device to come back up. Best-effort: some USB bridges
 * don't wire the reset lines.
 */
export const RTS_PULSE: WebSerialReset = {
  dropsStream: false,
  run: async (port) => {
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    await sleep(1000);
  },
};

/**
 * The reset the logs can run on *port* under *policy*: the RTS pulse, the
 * platform's reboot (where this browser can send it and the board behind the
 * port takes it), or undefined for no Reset device.
 */
export function webSerialReset(
  policy: SerialLogsPolicy,
  port: SerialPort | undefined
): WebSerialReset | undefined {
  if (policy.reset === "rts-pulse") return RTS_PULSE;
  const reset = platformReset(policy);
  if (!reset?.available()) return undefined;
  if (port && reset.supports && !reset.supports(port)) return undefined;
  return {
    dropsStream: true,
    run: async (live, cancelled) => {
      await reset.reboot(live, cancelled);
    },
  };
}
