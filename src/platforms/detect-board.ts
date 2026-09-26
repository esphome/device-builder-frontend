/**
 * The Device Builder's board detection behind "Set it up" and the wizard's
 * "Connect your board": pick a port when none is in hand, say what the port
 * is from its USB ids, run the ESP detect only where an ESP can be, and ask
 * for an RTL8720C behind a UART bridge when no ESP answered.
 */
import { SerialConnectTimeoutError } from "../util/serial-open-error.js";
import { requestSerialPort } from "../util/web-serial.js";
import {
  type DetectedBoard,
  detectEspBoard,
  EngineLoadError,
  UnsupportedChipError,
} from "./esp/index.js";
import { mayCarryEsp, type PortFamily, portFamily } from "./port-family.js";
import { loadAmbz2Engine } from "./rtl87xx/index.js";

export type BoardDetection =
  /** An ESP answered esptool. */
  | { kind: "esp"; board: DetectedBoard }
  /**
   * The port's USB ids name another platform's board outright, or its ROM
   * answered a probe; ``chip`` is the picker's chip key when the probe knows it.
   */
  | { kind: "family"; family: Exclude<PortFamily, "esp"> | "rtl87xx"; chip?: string }
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
  try {
    return { kind: "esp", board: await detectEspBoard(port, options) };
  } catch (err) {
    if (!worthRtlProbe(err, family) || !(await probeRtl8720c(port))) throw err;
    return { kind: "family", family: "rtl87xx", chip: "rtl8720c" };
  }
}

/**
 * Whether to ask for an RTL8720C after esptool failed: only on a UART bridge
 * or an id-less port (Espressif's own USB is an ESP), and only after
 * esptool's own connect failure. An unsupported chip answered the handshake,
 * a missing chunk says nothing about the board, and after a timeout the
 * hung handshake may still hold the port. The ESP detect goes first because
 * its DTR/RTS dance is harmless to an RTL kit, while the AmebaZ2 reset holds
 * PA00 and pulls CEN, a reset with IO0 held on an ESP kit.
 */
function worthRtlProbe(err: unknown, family: PortFamily | undefined): boolean {
  return (
    family !== "esp" &&
    !(err instanceof UnsupportedChipError) &&
    !(err instanceof EngineLoadError) &&
    !(err instanceof SerialConnectTimeoutError)
  );
}

/** The AmebaZ2 link probe; a chunk that fails to load is no answer either. */
async function probeRtl8720c(port: SerialPort): Promise<boolean> {
  const engine = await loadAmbz2Engine().catch((err: unknown) => {
    console.warn("[rtl87xx] Could not load the engine chunk for the probe:", err);
    return null;
  });
  if (!engine) return false;
  return engine.probeAmbz2(port, {
    onLog: (line) => console.debug(`[rtl87xx probe] ${line}`),
  });
}
