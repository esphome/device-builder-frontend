/**
 * The postMessage flash contract between the Device Builder dashboard (the
 * opener, on any http/https origin; ``esp/usb-flasher.ts``) and the receiver
 * on web.esphome.io (``src/web/flash-receiver/``), defined once for both.
 * The device-builder repo's ``flasher/src/protocol.ts`` mirrors it.
 *
 * The opener origin is unknown (the HA add-on runs on an arbitrary http
 * origin), so the channel is authenticated by a one-time ``nonce`` plus an
 * ``event.source === window.opener`` check, never an origin allowlist. The
 * nonce travels one way only (opener → receiver): inbound firmware must carry
 * it, but no outbound frame (ready/state/progress) echoes it, so the
 * pre-handoff ``ready`` broadcast leaks no secret.
 *
 * web.esphome.io deploys on its own, so every dashboard version must keep
 * working against every receiver. The version is bumped only for a breaking
 * change; every optional field below is additive in v1 and means what v1
 * did when absent.
 */
import type { FirmwareBinary } from "../api/types/firmware-jobs.js";

export const PROTOCOL_VERSION = 1;

export const MSG_READY = "esphome-web-flash:ready";
export const MSG_FIRMWARE = "esphome-web-flash:firmware";
export const MSG_STATE = "esphome-web-flash:state";
export const MSG_PROGRESS = "esphome-web-flash:progress";

/**
 * The flasher a hand-off is for: ``"esp"`` is esptool (ESP32 / ESP8266),
 * ``"rtl-ambz2"`` the RTL8720C ROM downloader. Named after the flasher, not
 * the platform: ``rtl87xx`` covers the RTL8710B too, whose ROM speaks another
 * protocol and gets its own id when it lands.
 */
export const HANDOFF_FLASHERS = ["esp", "rtl-ambz2"] as const;
export type HandoffFlasher = (typeof HANDOFF_FLASHERS)[number];
/** What an absent ``flasher`` or ``flashers`` means: esptool, as in v1. */
export const DEFAULT_HANDOFF_FLASHER: HandoffFlasher = "esp";

/** Whether an untrusted frame's ``flasher`` names one this build knows. */
export function isHandoffFlasher(value: unknown): value is HandoffFlasher {
  return (HANDOFF_FLASHERS as readonly unknown[]).includes(value);
}

/**
 * How the dashboard hands a platform's firmware over when it cannot flash
 * itself (an insecure origin): the flasher that takes it, whether that
 * flasher erases first, which built artifact to send (as one part at address
 * 0), the copy for a build without one, and a check of the artifact.
 */
export interface HandoffSpec {
  flasher: HandoffFlasher;
  erase: boolean;
  pick: (
    binaries: FirmwareBinary[],
    targetPlatform: string
  ) => FirmwareBinary | undefined;
  noArtifactKey: string;
  /**
   * Why the downloaded artifact is not this flasher's image; null when it
   * is. The device's chip already picked the flasher, so this is the
   * backstop for a build that disagrees with it. Checked before the flasher
   * tab is offered.
   */
  check?: (bytes: Uint8Array) => Promise<{ key: string; detail: string } | null>;
}

/**
 * Receiver → opener: announced (and re-announced) until firmware arrives.
 * - ``webSerial``: whether this receiver's browser can flash at all. The
 *   sender declines the hand-off only on an explicit ``false``.
 * - ``flashers``: the flashers this receiver has; absent means esptool only.
 */
export interface ReadyMessage {
  type: typeof MSG_READY;
  version: number;
  webSerial?: boolean;
  flashers?: HandoffFlasher[];
}

/** One image to write, bytes riding as a transferable ArrayBuffer. */
export interface FlashPartMessage {
  address: number;
  data: ArrayBuffer;
}

/** Opener → receiver: the firmware handoff. */
export interface FirmwareMessage {
  type: typeof MSG_FIRMWARE;
  nonce: string;
  /** The opener's protocol version; absent means v1. */
  version?: number;
  name?: string;
  /** The device's friendly name, for the receiver's title. */
  deviceName?: string;
  erase?: boolean;
  /**
   * Which flasher writes ``parts``; absent means esptool. An older receiver
   * ignores the field and would write anything as ESP parts, so a sender
   * puts a non-esp id only to a receiver whose ``flashers`` lists it, and a
   * receiver refuses an id it does not have. For ``rtl-ambz2`` the parts are
   * the LibreTiny UF2 as one part at address 0, which the receiver parses
   * into flash runs itself.
   */
  flasher?: HandoffFlasher;
  parts: FlashPartMessage[];
}

export type FlashState = "connecting" | "installing" | "done" | "error";

/**
 * Receiver → opener: the state the dashboard mirrors. ``note`` is what the
 * user has to do by hand at this point (strap the board into download mode,
 * reset it after the write); the dashboard shows it in place of its own line.
 */
export interface StateMessage {
  type: typeof MSG_STATE;
  state: FlashState;
  detail?: string;
  note?: string;
}

export interface ProgressMessage {
  type: typeof MSG_PROGRESS;
  pct: number;
}
