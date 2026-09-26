/**
 * The Device Builder's board detection behind "Set it up" and the wizard's
 * "Connect your board": pick a port when none is in hand, say what the port
 * is from its USB ids, and run the ESP detect only where an ESP can be.
 */
import { requestSerialPort } from "../util/web-serial.js";
import { type DetectedBoard, detectEspBoard } from "./esp/index.js";
import { mayCarryEsp, type PortFamily, portFamily } from "./port-family.js";

export type BoardDetection =
  /** An ESP answered esptool. */
  | { kind: "esp"; board: DetectedBoard }
  /** The port's USB ids name another platform's board outright. */
  | { kind: "family"; family: Exclude<PortFamily, "esp"> }
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
  if (family && family !== "esp") return { kind: "family", family };
  if (!mayCarryEsp(port)) return { kind: "unknown" };
  return { kind: "esp", board: await detectEspBoard(port, options) };
}
