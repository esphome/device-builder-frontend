import { sleep } from "./sleep.js";

/** Drop DTR and RTS, best effort: an adapter without the lines rejects. */
export async function releaseControlLines(port: SerialPort): Promise<void> {
  try {
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  } catch {
    // Nothing to do: the adapter has no control lines.
  }
}

/**
 * Reset a board through its auto-reset circuit: RTS high then low pulses EN,
 * with DTR (the boot strap) left released so it boots its firmware. Rejects
 * when the port refuses the lines (the cable was pulled).
 */
export async function pulseRts(port: SerialPort): Promise<void> {
  await port.setSignals({ dataTerminalReady: false, requestToSend: true });
  await port.setSignals({ dataTerminalReady: false, requestToSend: false });
}

/**
 * Pulse RTS for ``holdMs`` with DTR (the boot strap) released, so a board
 * whose RTS reaches its reset comes up in its firmware. False when the lines
 * could not be driven within ``withinMs``: no control lines, or a change left
 * pending on a board that was unplugged.
 */
export function resetIntoFirmware(
  port: SerialPort,
  holdMs: number,
  withinMs: number
): Promise<boolean> {
  const pulse = async (): Promise<boolean> => {
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await sleep(holdMs);
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    return true;
  };
  return Promise.race([pulse().catch(() => false), sleep(withinMs).then(() => false)]);
}
