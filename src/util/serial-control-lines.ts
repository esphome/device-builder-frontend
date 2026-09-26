/** Drop DTR and RTS, best effort: an adapter without the lines rejects. */
export async function releaseControlLines(port: SerialPort): Promise<void> {
  try {
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  } catch {
    // Nothing to do: the adapter has no control lines.
  }
}
