/**
 * A platform's Web Serial logs facts, stated once and applied by both the
 * Device Builder and web.esphome.io: how Reset device reaches the board, and
 * which control lines an open or a reopen leaves up. Each app runs the reset
 * and the line handling its own way.
 */

/** A platform's own Reset device: a reboot after which its port re-enumerates. */
export interface SerialPlatformReset {
  /** The browser can send it; the button stays hidden otherwise. */
  available(): boolean;
  /** Whether the board behind this port takes it (every port when omitted). */
  supports?(port: SerialPort): boolean;
  /**
   * Reboots the board behind *port* (closed by the caller); the logs reopen
   * the port once it comes back. False when ``cancelled`` flipped before
   * anything was sent.
   */
  reboot(port: SerialPort, cancelled: () => boolean): Promise<boolean>;
  /** Localize key for a platform-specific failure; the logs' generic key otherwise. */
  failureKey?(err: unknown): string | undefined;
}

export interface SerialLogsPolicy {
  /**
   * How Reset device reaches the board: an RTS pulse on its auto-reset
   * circuit, the platform's own reboot, or nothing (no button).
   */
  readonly reset?: "rts-pulse" | SerialPlatformReset;
  /** Drop DTR and RTS right after opening, so the board boots its firmware. */
  readonly releaseLinesAfterOpen?: boolean;
  /**
   * A reopen leaves DTR and RTS as opened instead of dropping them (which a
   * UART bridge's auto-reset circuit needs): the CDC only transmits while DTR
   * is asserted (arduino-pico).
   */
  readonly keepLinesOnReopen?: boolean;
}

/** ESP, and any board without its own policy: the auto-reset circuit's RTS pulse. */
export const DEFAULT_SERIAL_LOGS: SerialLogsPolicy = { reset: "rts-pulse" };

/** The policy's platform reset, or undefined for the RTS pulse or no reset. */
export function platformReset(
  policy: SerialLogsPolicy | undefined
): SerialPlatformReset | undefined {
  const reset = policy?.reset;
  return typeof reset === "object" ? reset : undefined;
}
