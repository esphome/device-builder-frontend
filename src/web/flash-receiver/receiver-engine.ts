import type { LocalizeFunc } from "../../common/localize.js";
import type { HandoffFlasher } from "../../platforms/handoff.js";
/**
 * What the flash receiver needs from a flasher: a check that the hand-off's
 * bytes are its kind of image, and a run against a picked port that reports
 * through the receiver's hooks. One per hand-off flasher id, registered in
 * ``RECEIVER_ENGINES``; the ``ready`` frame advertises the keys.
 */
import type { SerialLogsPolicy } from "../../platforms/serial-logs.js";
import type { FlashPart } from "../platforms/esp/firmware-build.js";
import type { FlashState } from "./protocol.js";

export interface ReceiverRunHooks {
  localize: LocalizeFunc;
  /** A state the opener mirrors, with the line the receiver shows for it. */
  onState: (state: FlashState, message: string) => void;
  onProgress: (percent: number) => void;
  onLog: (line: string) => void;
  /**
   * The board needs the user's hands (a strap, a button) before the engine
   * can go on; the receiver shows ``message`` and the guide link until the
   * engine reports the next state.
   */
  onWaiting?: (message: string, guideUrl?: string) => void;
}

export interface ReceiverEngine {
  /** The serial logs policy for the rebooted board's logs afterwards. */
  readonly logs: SerialLogsPolicy;
  /** Whether ``parts`` are this flasher's image; the reason when not. */
  validate(parts: FlashPart[], localize: LocalizeFunc): Promise<string | null>;
  /**
   * Flash ``parts`` over ``port`` (closed, authorized). Resolves true on a
   * finished install, false when it failed or was cancelled; the hooks
   * carry the detail. Never throws.
   */
  run(
    port: SerialPort,
    parts: FlashPart[],
    erase: boolean,
    hooks: ReceiverRunHooks
  ): Promise<boolean>;
}

export type ReceiverEngineLoader = () => Promise<ReceiverEngine>;

/**
 * The engines this receiver has, loaded on demand so the heavy ones stay out
 * of the main chunk. The keys are what the ``ready`` frame advertises.
 */
export const RECEIVER_ENGINES: Record<HandoffFlasher, ReceiverEngineLoader> = {
  esp: async () =>
    (await import("../platforms/esp/receiver-engine.js")).espReceiverEngine,
  "rtl-ambz2": async () =>
    (await import("../platforms/rtl87xx/receiver-engine.js")).rtlAmbz2ReceiverEngine,
};

export const RECEIVER_FLASHERS = Object.keys(RECEIVER_ENGINES) as HandoffFlasher[];
