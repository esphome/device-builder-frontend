import { isRtl87xxPlatform } from "./rtl87xx-platform.js";

/**
 * Whether a logs session releases DTR and RTS right after opening a port.
 * Chromium asserts both on open. An ESP board's auto-reset circuit reads a
 * change as a reset, so its lines stay as opened; a Pico or nRF52 native CDC
 * ignores them; an RTL8720C kit wires RTS to CEN (held, the chip sits in
 * reset) and DTR to PA00, the download strap (a reset with it held lands in
 * the ROM downloader), so both are released and the board boots into the
 * firmware.
 */
export function releasesLinesAfterOpen(
  targetPlatform: string | null | undefined
): boolean {
  return isRtl87xxPlatform(targetPlatform);
}

/** Drop DTR and RTS, best effort: an adapter without the lines rejects. */
export async function releaseControlLines(port: SerialPort): Promise<void> {
  try {
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  } catch {
    // Nothing to do: the adapter has no control lines.
  }
}
