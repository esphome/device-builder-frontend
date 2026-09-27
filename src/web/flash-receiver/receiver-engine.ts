import type { LocalizeFunc } from "../../common/localize.js";
import type { HandoffFlasher } from "../../platforms/handoff.js";
import type { SerialLogsPolicy } from "../../platforms/serial-logs.js";
import type { FlashPart } from "../platforms/esp/firmware-build.js";
import type { FlashState } from "./protocol.js";

export interface ReceiverRunHooks {
  /** A state the opener mirrors, with the line the receiver shows for it. */
  onState: (state: FlashState, message: string) => void;
  onProgress: (percent: number) => void;
  onLog: (line: string) => void;
  /**
   * The board needs the user's hands (a strap, a reset) before or after the
   * write; the receiver shows ``message`` with the guide link until the
   * engine reports the next state, and relays it as the done note when it
   * is what remains after a finished write.
   */
  onWaiting: (message: string, guideUrl?: string) => void;
}

/**
 * Flash the prepared image over ``port`` (closed, authorized). Resolves true
 * on a finished write, false when it failed; the hooks carry the detail.
 * Never throws.
 */
export type ReceiverRun = (port: SerialPort, hooks: ReceiverRunHooks) => Promise<boolean>;

/**
 * What the flash receiver needs from a flasher: check the hand-off's bytes
 * are its kind of image and plan the write, before the user picks a port,
 * so the click goes straight to the picker. One per hand-off flasher id,
 * registered in ``RECEIVER_ENGINES``; the ``ready`` frame advertises the keys.
 */
export interface ReceiverEngine {
  /** The serial logs policy for the rebooted board's logs afterwards. */
  readonly logs: SerialLogsPolicy;
  /** The run for ``parts``, or the reason they are not this flasher's image. Never throws. */
  prepare(
    parts: FlashPart[],
    erase: boolean,
    localize: LocalizeFunc
  ): Promise<{ run: ReceiverRun } | { error: string }>;
}

/**
 * The engines this receiver has, loaded on demand so the heavy ones stay out
 * of the main chunk. The keys are what the ``ready`` frame advertises.
 */
export const RECEIVER_ENGINES: Record<HandoffFlasher, () => Promise<ReceiverEngine>> = {
  esp: async () =>
    (await import("../platforms/esp/receiver-engine.js")).espReceiverEngine,
  "rtl-ambz2": async () =>
    (await import("../platforms/rtl87xx/receiver-engine.js")).rtlAmbz2ReceiverEngine,
};

export const RECEIVER_FLASHERS = Object.keys(RECEIVER_ENGINES) as HandoffFlasher[];
