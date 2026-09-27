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

/** A finished write: what is left to do by hand, and where its logs are. */
export interface ReceiverResult {
  note?: ReceiverNote;
  /** The line for a finish that is not an install, in place of the receiver's. */
  message?: string;
  /** Absent: no logs follow. */
  logs?: ReceiverLogs;
}

/** The serial port a write went over, for the board's logs afterwards. */
export interface ReceiverLogs {
  port: SerialPort;
  /** The ports authorized before the write, to tell the rebooted board's port apart. */
  knownPorts: SerialPort[];
  /** Whether the board is booting; if not, the logs wait for a reset by hand. */
  rebooted: boolean;
}

/**
 * Flash the prepared image, from the click: the engine opens its own chooser
 * first, with nothing awaited before it. ``"dismissed"`` when the chooser was
 * closed, null when it failed; the hooks carried the detail. Never throws.
 */
export type ReceiverRun = (
  hooks: ReceiverRunHooks
) => Promise<ReceiverResult | "dismissed" | null>;

/**
 * A step ahead of the install on a click of its own, for a board that has to
 * be put into its bootloader first. Opens its own chooser like the run, and
 * ends like it: ``"dismissed"``, or null with what happened on the hooks.
 * Never throws.
 */
export interface ReceiverStep {
  label: string;
  run: (hooks: ReceiverRunHooks) => Promise<"dismissed" | null>;
}

/** A checked image, ready to install from a click. */
export interface ReceiverPlan {
  run: ReceiverRun;
  before?: ReceiverStep;
  /** What to do with the board, in place of the receiver's own hint. */
  hint?: string;
  /** The install button's label, in place of the receiver's own. */
  primaryLabel?: string;
}

/**
 * The bytes of a hand-off that is one UF2 whole, as one part at address 0;
 * undefined for anything else.
 */
export function singleUf2Part(parts: FlashPart[]): Uint8Array | undefined {
  return parts.length === 1 && parts[0].address === 0 ? parts[0].data : undefined;
}

/**
 * What the flash receiver needs from a flasher: check the hand-off's bytes
 * are its kind of image and plan the write, before the user picks a device,
 * so the click goes straight to the chooser. One per hand-off flasher id,
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
  ): Promise<ReceiverPlan | { error: string; retryable?: boolean }>;
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
  "rp2-picoboot": async () =>
    (await import("../platforms/rp2/receiver-engine.js")).rp2PicobootReceiverEngine,
};
