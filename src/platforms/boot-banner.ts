/**
 * What a board says about itself on the UART when it boots. Behind a UART
 * bridge the USB ids name nothing, but every ROM and firmware announces
 * itself on reset, so one reset and one short read at 115200 name the
 * family, the chip, or the exact board, for as many families as there are
 * lines in the table (#1866). Shared by both apps; nothing here touches the
 * DOM or an engine.
 */
import { pulseRts } from "../util/serial-control-lines.js";
import { withDeadline } from "../util/with-deadline.js";

/** What a banner said: the platform (``"esp"`` means run esptool), its chip
 *  (the board picker's ``mcu`` key), and the exact board id when named. */
export interface BootBannerMatch {
  platform?: string;
  mcu?: string;
  board?: string;
}

/** The ROM's own lines arrive within a few hundred ms; LibreTiny's banner
 *  follows the bootloader a little later. Measured on the bench (#1866). */
export const BOOT_BANNER_MS = 800;
const BOOT_BANNER_BAUD = 115200;
/** The whole read, open to close, so a port that hangs cannot hold the detect. */
const BOOT_BANNER_DEADLINE_MS = 3000;

/**
 * One line per thing a boot log can say. Order does not decide between
 * families (they name themselves); a later line adds to an earlier one, so
 * the RTL ROM's chip and LibreTiny's board id combine.
 */
const SIGNATURES: ReadonlyArray<{
  pattern: RegExp;
  match: (m: RegExpMatchArray) => BootBannerMatch;
}> = [
  // The AmebaZ2 ROM, in every state (download mode included): "== Rtl8710c
  // IoT Platform ==".
  {
    pattern: /Rtl8710c IoT Platform/,
    match: () => ({ platform: "rtl87xx", mcu: "rtl8720c" }),
  },
  // LibreTiny names its board: "LibreTiny v1.13.0+sha.6514b26 on bw15,
  // compiled at ...". The catalog knows the board's family.
  { pattern: /LibreTiny v\S+ on ([a-z0-9][a-z0-9_-]*)/, match: (m) => ({ board: m[1] }) },
  // The ESP32 family's ROM ("rst:0x1 (POWERON_RESET),boot:0x13 ...") and the
  // IDF bootloader; esptool takes it from here. The ESP8266 ROM speaks at
  // 74880 and matches nothing, which lands it with esptool all the same.
  {
    pattern: /\brst:0x[0-9a-f]+ \(|\bboot\.esp32|ESP-IDF \S+ 2nd stage bootloader/,
    match: () => ({ platform: "esp" }),
  },
];

/** What ``text`` names, or null when nothing in it is known. */
export function matchBootBanner(text: string): BootBannerMatch | null {
  let hit: BootBannerMatch | null = null;
  for (const { pattern, match } of SIGNATURES) {
    const m = text.match(pattern);
    if (m) hit = { ...(hit ?? {}), ...match(m) };
  }
  return hit;
}

/** Whether ``hit`` leaves nothing more for the rest of the window to add. */
const isSettled = (hit: BootBannerMatch | null): boolean =>
  hit?.platform === "esp" || hit?.board !== undefined;

/**
 * Reset the board behind *port* (RTS pulse, DTR released, the plain reset a
 * bridge's auto-reset circuit gives) and read what it prints at 115200 for
 * up to ``BOOT_BANNER_MS``, stopping early once the text is conclusive.
 * The port is opened here and closed after. Resolves the text, which may be
 * empty; rejects only when the port cannot be opened or the whole thing
 * outlives its deadline.
 */
export async function readBootBanner(port: SerialPort): Promise<string> {
  await port.open({ baudRate: BOOT_BANNER_BAUD });
  try {
    return await withDeadline(
      readAfterReset(port),
      BOOT_BANNER_DEADLINE_MS,
      () => new Error(`Boot banner not read in ${BOOT_BANNER_DEADLINE_MS} ms`)
    );
  } finally {
    await port.close().catch(() => {});
  }
}

async function readAfterReset(port: SerialPort): Promise<string> {
  // An adapter without control lines cannot reset the board; whatever it
  // prints on its own is still worth a look.
  await pulseRts(port).catch(() => {});
  const readable = port.readable;
  if (!readable) return "";
  const reader = readable.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const deadline = Date.now() + BOOT_BANNER_MS;
  let text = "";
  try {
    while (Date.now() < deadline) {
      const chunk = await withDeadline(
        reader.read(),
        deadline - Date.now(),
        () => new Error("window closed")
      ).catch(() => null);
      if (!chunk || chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
      if (isSettled(matchBootBanner(text))) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return text;
}
