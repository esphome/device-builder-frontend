import type { LocalizeFunc } from "../../common/localize.js";
import type { SerialLogsPolicy } from "../../platforms/serial-logs.js";
import type { FlashPart } from "../platforms/esp/firmware-build.js";
import type { FlashState, HandoffFlasher } from "./protocol.js";

export interface ReceiverRunHooks {
  /** A state the opener mirrors, with the line the receiver shows for it. */
  onState: (state: FlashState, message: string) => void;
  onProgress: (percent: number) => void;
  onLog: (line: string) => void;
  /**
   * The board needs the user's hands before the engine can go on (a strap);
   * the receiver shows the note until the engine reports the next state.
   */
  onWaiting: (note: ReceiverNote) => void;
}

/** What the user has to do by hand, with the flasher's guide when it has one. */
export interface ReceiverNote {
  message: string;
  guide?: { url: string; label: string };
}

/** A finished write: whether the board is booting, and what is left to do by hand. */
export interface ReceiverResult {
  rebooted: boolean;
  note?: ReceiverNote;
}

/**
 * Flash the prepared image over ``port`` (closed, authorized). Null when it
 * failed; the hooks carried the detail. Never throws.
 */
export type ReceiverRun = (
  port: SerialPort,
  hooks: ReceiverRunHooks
) => Promise<ReceiverResult | null>;

/**
 * What the flash receiver needs from a flasher: check the hand-off's bytes
 * are its kind of image and plan the write, before the user picks a port,
 * so the click goes straight to the picker. One per hand-off flasher id,
 * registered in ``RECEIVER_ENGINES``, which holds every id the ``ready`` frame
 * advertises (``HANDOFF_FLASHERS``).
 */
export interface ReceiverEngine {
  /** The serial logs policy for the rebooted board's logs afterwards. */
  readonly logs: SerialLogsPolicy;
  /**
   * The run for ``parts``, or why there is none: they are not this flasher's
   * image, or (``retryable``) a chunk the check needs did not load. Never
   * throws.
   */
  prepare(
    parts: FlashPart[],
    erase: boolean,
    localize: LocalizeFunc
  ): Promise<{ run: ReceiverRun } | { error: string; retryable?: boolean }>;
}

/**
 * The engines this receiver has, loaded on demand so the heavy ones stay out
 * of the main chunk.
 */
export const RECEIVER_ENGINES: Record<HandoffFlasher, () => Promise<ReceiverEngine>> = {
  esp: async () =>
    (await import("../platforms/esp/receiver-engine.js")).espReceiverEngine,
  "rtl-ambz2": async () =>
    (await import("../platforms/rtl87xx/receiver-engine.js")).rtlAmbz2ReceiverEngine,
};
