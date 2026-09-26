/**
 * The Device Builder's board detection behind "Set it up" and the wizard's
 * "Connect your board": pick a port when none is in hand, say what the port
 * is from its USB ids, run the ESP detect only where an ESP can be, and
 * when no ESP answered on a UART bridge, let the other platforms ask their
 * own ROMs.
 */
import { requestSerialPort } from "../util/web-serial.js";
import { type DetectedBoard, detectEspBoard, NoEspAnswerError } from "./esp/index.js";
import { mayCarryEsp, portFamily } from "./port-family.js";
import { probeBridgePort } from "./registry.js";

export type BoardDetection =
  /** An ESP answered esptool. */
  | { kind: "esp"; board: DetectedBoard }
  /**
   * The port's USB ids name a platform's board outright, or a platform's ROM
   * answered its probe; ``mcu`` is the board picker's chip key when known.
   */
  | { kind: "family"; platform: string; mcu?: string }
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
  try {
    return { kind: "esp", board: await detectEspBoard(port, options) };
  } catch (err) {
    // Only when nothing answered esptool on a port that can front any board
    // (a bridge, or one without ids); Espressif's own USB is an ESP whatever
    // it said. esptool goes first: its DTR/RTS dance is harmless to the other
    // families, while their probes reset the board with its strap held.
    if (!(err instanceof NoEspAnswerError) || family === "esp") throw err;
    const probed = await probeBridgePort(port);
    if (!probed) throw err;
    return { kind: "family", ...probed };
  }
}
