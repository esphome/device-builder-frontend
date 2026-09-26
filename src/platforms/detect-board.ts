/**
 * The Device Builder's board detection behind "Set it up" and the wizard's
 * "Connect your board": pick a port when none is in hand, say what the port
 * is from its USB ids, read the boot banner where the ids say nothing, and
 * run the ESP detect only where an ESP can be.
 */
import { requestSerialPort } from "../util/web-serial.js";
import { matchBootBanner, readBootBanner } from "./boot-banner.js";
import { type DetectedBoard, detectEspBoard } from "./esp/index.js";
import { mayCarryEsp, portFamily } from "./port-family.js";

export type BoardDetection =
  /** An ESP answered esptool. */
  | { kind: "esp"; board: DetectedBoard }
  /**
   * The port's USB ids name a platform's board outright, or its boot banner
   * did; ``mcu`` is the board picker's chip key and ``board`` the catalog id
   * when the banner named them.
   */
  | { kind: "family"; platform: string; mcu?: string; board?: string }
  /** The boot banner named the board but not its platform; the catalog knows. */
  | { kind: "board"; board: string }
  /** A native-USB device of no family we know; the user picks by hand. */
  | { kind: "unknown" };

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
  if (family && family !== "esp") return { kind: "family", platform: family };
  if (!mayCarryEsp(port)) return { kind: "unknown" };
  if (!family) {
    // A bridge or an id-less port fronts anything: one reset and a short
    // read of the boot log names most boards outright, and only an ESP (or
    // a silent board, such as an ESP8266 whose ROM speaks at 74880) goes on
    // to esptool. A port that will not open is esptool's to report.
    const banner = await readBootBanner(port).catch((err: unknown) => {
      console.warn("[detect] Could not read the boot banner:", err);
      return "";
    });
    const hit = matchBootBanner(banner);
    if (hit && hit.platform !== "esp") {
      return hit.platform
        ? { kind: "family", platform: hit.platform, mcu: hit.mcu, board: hit.board }
        : { kind: "board", board: hit.board! };
    }
  }
  return { kind: "esp", board: await detectEspBoard(port, options) };
}
