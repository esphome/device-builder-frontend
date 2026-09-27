/**
 * What a board says about itself on the UART when it boots. Behind a UART
 * bridge the USB ids name nothing, but every ROM and firmware announces
 * itself on reset, so one reset and one short read at 115200 name the
 * family, the chip, or the exact board, for as many families as there are
 * lines in the table (#1866). Shared by both apps; nothing here touches the
 * DOM or an engine.
 */
import { openSerialPort } from "../util/serial-open-error.js";
import { settledWithin, withDeadline } from "../util/with-deadline.js";

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
/** How long the teardown gets before the detect moves on without it. */
const TEARDOWN_MS = 2000;

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
  const hit: BootBannerMatch = {};
  for (const { pattern, match } of SIGNATURES) {
    const m = text.match(pattern);
    if (m) Object.assign(hit, match(m));
  }
  return Object.keys(hit).length ? hit : null;
}

/** Whether ``hit`` leaves nothing more for the rest of the window to add. */
const isSettled = (hit: BootBannerMatch | null): boolean =>
  hit?.platform === "esp" || hit?.board !== undefined;

/**
 * Reset the board behind *port* (RTS pulse, DTR released, the plain reset a
 * bridge's auto-reset circuit gives) and read what it prints at 115200 for
 * up to ``BOOT_BANNER_MS``, stopping early once the text is conclusive. The
 * port is opened here and closed after. Resolves what the text named, or
 * null; rejects only when the port cannot be opened (marked, so the copy can
 * say it is held elsewhere) or the whole thing outlives its deadline, after
 * which the abandoned read touches the port no further: esptool may have it
 * by then.
 */
export async function readBootBanner(port: SerialPort): Promise<BootBannerMatch | null> {
  await openSerialPort(port, { baudRate: BOOT_BANNER_BAUD });
  const session: BannerSession = { abandoned: false };
  try {
    return await withDeadline(
      readAfterReset(port, session),
      BOOT_BANNER_DEADLINE_MS,
      () => {
        session.abandoned = true;
        return new Error(`Boot banner not read in ${BOOT_BANNER_DEADLINE_MS} ms`);
      }
    );
  } finally {
    // A reader the abandoned read still holds would keep the port from
    // closing, and a teardown that hangs must not hold the detect either;
    // both are worth knowing about, since esptool's open fails next and its
    // copy would blame another program.
    const teardown = (async () => {
      await session.reader?.cancel().catch(() => {});
      await port.close().catch((err: unknown) => {
        console.warn(
          "[detect] Could not close the port after the boot banner read:",
          err
        );
      });
    })();
    if (!(await settledWithin(teardown, TEARDOWN_MS))) {
      console.warn(
        `[detect] The port did not close in ${TEARDOWN_MS} ms after the boot banner read`
      );
    }
  }
}

interface BannerSession {
  /** The deadline passed; the port is no longer ours to touch. */
  abandoned: boolean;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
}

async function readAfterReset(
  port: SerialPort,
  session: BannerSession
): Promise<BootBannerMatch | null> {
  // An adapter without control lines cannot reset the board; whatever it
  // prints on its own is still worth a look, so a refused pulse is logged,
  // not fatal. The pulse checks between its two line changes: past the
  // deadline the port may be esptool's, and its lines are esptool's too.
  try {
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    if (session.abandoned) return null;
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  } catch (err) {
    console.debug("[detect] Could not pulse reset for the boot banner:", err);
  }
  if (session.abandoned) return null;
  const reader = port.readable!.getReader();
  session.reader = reader;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  // The window closes by cancelling the reader, which ends a pending read.
  const window = setTimeout(() => void reader.cancel().catch(() => {}), BOOT_BANNER_MS);
  let text = "";
  let hit: BootBannerMatch | null = null;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      hit = matchBootBanner(text);
      if (isSettled(hit)) break;
    }
  } finally {
    clearTimeout(window);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    session.reader = undefined;
  }
  return hit;
}
