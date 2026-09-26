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
