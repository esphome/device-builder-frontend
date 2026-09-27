/**
 * What a board says about itself on the UART when it boots. Behind a UART
 * bridge the USB ids name nothing, but every ROM and firmware announces
 * itself on reset, so one reset and one short read at 115200 name the
 * family, the chip, or the exact board, for as many families as there are
 * lines in the table (#1866). The Device Builder's detect reads it; nothing
 * here touches the DOM or an engine, so ESPHome Web can share it.
 */
import {
  openSerialPort,
  SerialOpenTimeoutError,
  SerialPortHeldError,
} from "../util/serial-open-error.js";
import { settledWithin, withDeadline } from "../util/with-deadline.js";

/** What a banner said: the platform (``"esp"`` means run esptool), its chip
 *  (the board picker's ``mcu`` key), and the exact board id when named. */
export interface BootBannerMatch {
  platform?: string;
  mcu?: string;
  board?: string;
  /** The port could not be released after the read; it stays held until replugged. */
  portHeld?: boolean;
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
  // compiled at ...". The catalog knows the board's family. The comma is
  // required: reads split anywhere, and "on bw" must not settle as "bw".
  {
    pattern: /LibreTiny v\S+ on ([a-z0-9][a-z0-9_-]*),/,
    match: (m) => ({ board: m[1] }),
  },
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
 * port is opened here and closed after, all under one deadline. Resolves
 * what the text named, or null. Rejects when the port cannot be opened
 * (marked, so the copy can say it is held elsewhere), when it had not
 * opened by the deadline (``SerialOpenTimeoutError``: the caller must not
 * hand it on, since nobody else can open it either and the abandoned
 * session closes it should it open late), when the whole read outlives the
 * deadline, or when the port could not be released afterwards and nothing
 * was found (``SerialPortHeldError``: the next open fails and its copy would
 * blame another program).
 */
export async function readBootBanner(port: SerialPort): Promise<BootBannerMatch | null> {
  const session: BannerSession = { abandoned: false, opened: false };
  let hit: BootBannerMatch | null = null;
  let failure: unknown;
  try {
    hit = await withDeadline(
      readAfterReset(port, session),
      BOOT_BANNER_DEADLINE_MS,
      () => {
        session.abandoned = true;
        return session.opened
          ? new Error(`Boot banner not read in ${BOOT_BANNER_DEADLINE_MS} ms`)
          : new SerialOpenTimeoutError(BOOT_BANNER_DEADLINE_MS);
      }
    );
  } catch (err) {
    failure = err;
  }
  const released = session.opened ? await teardown(port, session) : true;
  // A port still held outranks whatever else went wrong: with nothing found
  // it would go to esptool next, which must not happen. A board the banner
  // named is a result whatever the port did afterwards, marked so the caller
  // can say the board must be replugged before it is flashed.
  const named = hit !== null && hit.platform !== "esp";
  if (!released && !named) throw new SerialPortHeldError();
  if (failure !== undefined) throw failure;
  return released ? hit : { ...hit, portHeld: true };
}

interface BannerSession {
  /** The deadline passed; the port is no longer ours to touch. */
  abandoned: boolean;
  /** Our open went through, so the close is ours to do. */
  opened: boolean;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
}

/**
 * Cancel any reader the read still holds and close the port, in a bounded
 * time: a teardown that hangs must not hold the detect. True when the port
 * closed; a close that failed or hung is logged and reported, since the next
 * open fails and its copy would blame another program.
 */
async function teardown(port: SerialPort, session: BannerSession): Promise<boolean> {
  let closed = false;
  const release = (async () => {
    await session.reader?.cancel().catch(() => {});
    await port.close().then(
      () => {
        closed = true;
      },
      (err: unknown) => {
        console.warn(
          "[detect] Could not close the port after the boot banner read:",
          err
        );
      }
    );
  })();
  if (!(await settledWithin(release, TEARDOWN_MS))) {
    console.warn(
      `[detect] The port did not close in ${TEARDOWN_MS} ms after the boot banner read`
    );
  }
  return closed;
}

// Web Serial raises these on the read and then offers a fresh ``readable``;
// the port itself is fine. A reset pulse can produce one at 115200.
const RECOVERABLE_READ_ERRORS = new Set([
  "BufferOverrunError",
  "FramingError",
  "BreakError",
  "ParityError",
]);

async function readAfterReset(
  port: SerialPort,
  session: BannerSession
): Promise<BootBannerMatch | null> {
  await openSerialPort(port, { baudRate: BOOT_BANNER_BAUD });
  session.opened = true;
  if (session.abandoned) {
    // Opened only after the deadline: nobody is waiting, so close it now.
    await teardown(port, session);
    return null;
  }
  await pulseReset(port, session);
  if (session.abandoned) return null;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  // The window closes by cancelling whichever reader is current, which ends
  // its pending read.
  let open = true;
  const window = setTimeout(() => {
    open = false;
    void session.reader?.cancel().catch(() => {});
  }, BOOT_BANNER_MS);
  let text = "";
  let hit: BootBannerMatch | null = null;
  try {
    while (open && port.readable) {
      const reader = port.readable.getReader();
      session.reader = reader;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return hit;
          text += decoder.decode(value, { stream: true });
          hit = matchBootBanner(text);
          if (isSettled(hit)) return hit;
        }
      } catch (err) {
        // A recoverable error ends this stream, not the port: keep what was
        // read and go on with the fresh one while the window is open.
        if (!(err instanceof DOMException && RECOVERABLE_READ_ERRORS.has(err.name)))
          throw err;
        console.debug(
          "[detect] Recoverable read error during the boot banner:",
          err.name
        );
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
        session.reader = undefined;
      }
    }
    return hit;
  } finally {
    clearTimeout(window);
  }
}

/**
 * The reset pulse, RTS up then down with DTR released. An adapter without
 * control lines cannot reset the board; whatever it prints on its own is
 * still worth a look, so a refused pulse is logged, not fatal. Between the
 * two line changes the pulse checks whether the deadline passed: past it
 * the port may be esptool's, and its lines are esptool's too. A release
 * that fails after the assert went through would leave the board held in
 * reset, so it is tried once more and warned about.
 */
async function pulseReset(port: SerialPort, session: BannerSession): Promise<void> {
  try {
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
  } catch (err) {
    console.debug("[detect] Could not pulse reset for the boot banner:", err);
    return;
  }
  if (session.abandoned) return;
  const release = () =>
    port.setSignals({ dataTerminalReady: false, requestToSend: false });
  await release().catch(async (err: unknown) => {
    console.warn(
      "[detect] Could not release reset after the boot banner pulse; trying once more:",
      err
    );
    if (!session.abandoned) {
      await release().catch((again: unknown) => {
        console.warn(
          "[detect] Reset still held after the retry; the board stays in reset:",
          again
        );
      });
    }
  });
}
