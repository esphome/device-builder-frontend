/**
 * A platform's Web Serial logs facts, stated once and applied by both the
 * Device Builder and web.esphome.io: how Reset device reaches the board, and
 * whether an open releases the control lines. Each app runs the reset its own
 * way; the line rules below are shared.
 */
import { releaseControlLines } from "../util/serial-control-lines.js";
import { isRp2CdcPort } from "./rp2/web-usb.js";

/** A platform's own Reset device: a reboot after which its port re-enumerates. */
export interface SerialPlatformReset {
  /** The browser can send it; the button stays hidden otherwise. */
  available(): boolean;
  /** Whether the board behind this port takes it. */
  supports(port: SerialPort): boolean;
  /**
   * Reboots the board behind *port* (closed by the caller); the logs reopen
   * the port once it comes back. False when ``cancelled`` flipped before
   * anything was sent.
   */
  reboot(port: SerialPort, cancelled: () => boolean): Promise<boolean>;
  /** Localize key for a platform-specific failure; the logs' generic key otherwise. */
  failureKey(err: unknown): string | undefined;
}

export interface SerialLogsPolicy {
  /**
   * How Reset device reaches the board: an RTS pulse on its auto-reset
   * circuit, the platform's own reboot, or nothing (no button).
   */
  readonly reset?: "rts-pulse" | SerialPlatformReset;
  /** Drop DTR and RTS right after opening, so the board boots its firmware. */
  readonly releaseLinesAfterOpen?: boolean;
}

/** The policy's platform reset, or undefined for the RTS pulse or no reset. */
export function platformReset(
  policy: SerialLogsPolicy | undefined
): SerialPlatformReset | undefined {
  const reset = policy?.reset;
  return typeof reset === "object" ? reset : undefined;
}

/**
 * The Reset device the logs can offer: the RTS pulse, or the platform's
 * reboot where this browser can send it and (given a port) the board behind
 * it takes it; undefined for no button.
 */
export function offeredReset(
  policy: SerialLogsPolicy,
  port?: SerialPort
): "rts-pulse" | SerialPlatformReset | undefined {
  if (policy.reset === "rts-pulse") return "rts-pulse";
  const reset = platformReset(policy);
  if (!reset?.available()) return undefined;
  return port && !reset.supports(port) ? undefined : reset;
}

/**
 * A reopen asserts DTR and RTS: drop them, which a UART bridge's auto-reset
 * circuit needs, except on a Pico's own CDC, where arduino-pico only
 * transmits while DTR is asserted (whichever flow reached the port).
 */
export async function releaseLinesAfterReopen(port: SerialPort): Promise<void> {
  if (!isRp2CdcPort(port)) await releaseControlLines(port);
}
