/** Realtek AmebaZ / AmebaZ2 (ESPHome platform ``rtl87xx``). Fail-closed on empty / unknown. */
export function isRtl87xxPlatform(targetPlatform: string | null | undefined): boolean {
  return (targetPlatform ?? "").toLowerCase().startsWith("rtl87xx");
}

/**
 * Release DTR and RTS on a port just opened for an RTL8720C board's logs.
 * Chromium asserts both on open; on the usual kits RTS drives CEN (the chip
 * sits in reset while it is held) and DTR drives PA00, the download strap
 * (a reset with it held lands in the ROM downloader). Releasing both lets
 * the board boot into the firmware. Best effort: an adapter without the
 * lines rejects, and the board is running already.
 */
export async function releaseRtl87xxLines(port: SerialPort): Promise<void> {
  try {
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  } catch {
    // No control lines on this adapter.
  }
}
