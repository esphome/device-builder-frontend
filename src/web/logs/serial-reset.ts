import { sleep } from "../../util/sleep.js";

/**
 * How Reset Device reaches a board in the logs. The card that opens the logs
 * hands its family's in (``reset`` on the logs dialog); ``undefined`` means
 * the port has no way to reset the board (an nRF52's CDC).
 */
export interface WebSerialReset {
  /** The browser can send it; the button stays hidden otherwise. */
  available(): boolean;
  /**
   * The reset re-enumerates the port (a Pico rebooting through BOOTSEL), so
   * the stream is dropped first and resumed after.
   */
  readonly dropsStream: boolean;
  run(port: SerialPort, cancelled: () => boolean): Promise<void>;
  /** Localize key for a failed reset (``web.logs.reset_failed`` otherwise). */
  failureKey?(err: unknown): string;
}

/**
 * Pulse RTS to reboot the running app so the user can capture boot logs,
 * matching legacy ewt-console.reset(): RTS high then low back-to-back, then a
 * 1s settle for the device to come back up. Best-effort: some USB bridges
 * don't wire the reset lines.
 */
export const RTS_PULSE: WebSerialReset = {
  available: () => true,
  dropsStream: false,
  run: async (port) => {
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    await sleep(1000);
  },
};
