import type { SerialLineHooks } from "../../util/serial-log-stream.js";

/**
 * A transport the web logs dialog streams from. The dialog owns one
 * reconnect loop (announce the drop, count silent comebacks, give up); the
 * source owns the handle: how to attach, how to come back after a drop, and
 * what to release when the stream is dead.
 */
export interface WebLogSource {
  /**
   * Start streaming; resolves the cancel, which also releases the transport.
   * ``cancelled`` turning true means the dialog moved on: stop retrying, and
   * a handle acquired after that is the source's to release.
   */
  attach(hooks: SerialLineHooks, cancelled: () => boolean): Promise<() => Promise<void>>;
  /** After a drop: a live stream again, or null when the device stayed gone. */
  resume(
    hooks: SerialLineHooks,
    cancelled: () => boolean
  ): Promise<(() => Promise<void>) | null>;
  /** Drop whatever a dead stream left behind; nothing else will. */
  release(): void;
  /** Reboot the device behind the source in place, when its wiring allows it. */
  reset?(): Promise<void>;
  /**
   * Reboot a device whose port re-enumerates on reset (a Pico through
   * BOOTSEL). The caller has cancelled the stream, which closed the port;
   * resolves the fresh stream's cancel, null when the device never came
   * back, and throws when it was left in a state the user has to fix.
   */
  reboot?(
    hooks: SerialLineHooks,
    cancelled: () => boolean
  ): Promise<(() => Promise<void>) | null>;
}
