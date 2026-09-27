/**
 * The Device Builder's board detection behind "Set it up" and the wizard's
 * "Connect your board": pick a port when none is in hand, say what the port
 * is from its USB ids, read the boot banner where the ids say nothing, and
 * run the ESP detect only where an ESP can be.
 */
import {
  SerialOpenTimeoutError,
  SerialPortHeldError,
} from "../util/serial-open-error.js";
import { requestSerialPort } from "../util/web-serial.js";
import { type BootBannerMatch, readBootBanner } from "./boot-banner.js";
import { type DetectedBoard, detectEspBoard, preloadEsptool } from "./esp/index.js";
import { mayCarryEsp, portFamily } from "./port-family.js";

export type BoardDetection =
  /** An ESP answered esptool. */
  | { kind: "esp"; board: DetectedBoard }
  /**
   * The board named itself without esptool, by its USB ids or its boot
   * banner: its platform, its chip (the board picker's ``mcu`` key) and the
   * catalog board id, whichever were said.
   */
  | ({ kind: "named" } & BootBannerMatch)
  /** A native-USB device of no family we know; the user picks by hand. */
  | { kind: "unknown" };

/** The catalog board id a detection named, if any. */
export function detectedBoardId(detection: BoardDetection): string | undefined {
  switch (detection.kind) {
    case "esp":
      return detection.board.manifest?.board_id;
    case "named":
      return detection.board;
    default:
      return undefined;
  }
}

/**
 * Detect the board behind *port*, or behind a port picked here when none is
 * given. ``null`` when the picker was dismissed; the ESP path's errors
 * (``EngineLoadError``, ``UnsupportedChipError``, the connect failure) are
 * thrown as they are.
 */
export async function detectBoard(
  port: SerialPort | null,
  options: { readMac?: boolean } = {}
): Promise<BoardDetection | null> {
  if (!port) {
    // The wizard warms the engine chunk on mount, so an ESP behind the
    // picked port rarely waits for it here.
    port = await requestSerialPort();
    if (!port) return null;
  }
  const family = portFamily(port);
  if (family && family !== "esp") return { kind: "named", platform: family };
  if (!mayCarryEsp(port)) return { kind: "unknown" };
  if (!family) {
    // A bridge or an id-less port fronts anything: one reset and a short
    // read of the boot log names most boards outright, and only an ESP (or
    // a silent board, such as an ESP8266 whose ROM speaks at 74880) goes on
    // to esptool, whose chunk fetches meanwhile. A port that refused to open
    // is esptool's to report; one whose open never came back, or that could
    // not be released, is not handed on at all: it is still ours, and the
    // next open would fail with copy that blames another program.
    preloadEsptool();
    const hit = await readBootBanner(port).catch((err: unknown) => {
      if (err instanceof SerialOpenTimeoutError || err instanceof SerialPortHeldError)
        throw err;
      console.warn("[detect] Could not read the boot banner:", err);
      return null;
    });
    if (hit && hit.platform !== "esp") return { kind: "named", ...hit };
  }
  return { kind: "esp", board: await detectEspBoard(port, options) };
}
