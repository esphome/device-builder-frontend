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
 * held ``holdMs``, with DTR (the boot strap) left released so it boots its
 * firmware. Rejects when the port refuses the lines (the cable was pulled).
 */
export async function pulseRts(port: SerialPort, holdMs = 0): Promise<void> {
  await port.setSignals({ dataTerminalReady: false, requestToSend: true });
  if (holdMs) await sleep(holdMs);
  await port.setSignals({ dataTerminalReady: false, requestToSend: false });
}

/**
 * ``pulseRts`` for a board whose RTS reaches its reset, so it comes up in its
 * firmware. False when the lines could not be driven within ``withinMs``: no
 * control lines, or a change left pending on a board that was unplugged.
 */
export function resetIntoFirmware(
  port: SerialPort,
  holdMs: number,
  withinMs: number
): Promise<boolean> {
  return Promise.race([
    pulseRts(port, holdMs).then(
      () => true,
      () => false
    ),
    sleep(withinMs).then(() => false),
  ]);
}
