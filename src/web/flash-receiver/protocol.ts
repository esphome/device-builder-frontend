/**
 * The postMessage flash contract between the Device Builder dashboard (the
 * opener, on any http/https origin) and this receiver (a fixed secure-context
 * origin, web.esphome.io). Mirrors the sender in ``src/util/usb-flasher.ts``
 * and the reference in the device-builder repo's ``flasher/src/protocol.ts``.
 *
 * The opener origin is unknown (the HA add-on runs on an arbitrary http
 * origin), so the channel is authenticated by a one-time ``nonce`` plus an
 * ``event.source === window.opener`` check, never an origin allowlist. The
 * nonce travels one way only (opener → receiver): inbound firmware must carry
 * it, but no outbound frame (ready/state/progress) echoes it, so the
 * pre-handoff ``ready`` broadcast leaks no secret.
 */
export const PROTOCOL_VERSION = 1;

export const MSG_READY = "esphome-web-flash:ready";
export const MSG_FIRMWARE = "esphome-web-flash:firmware";
export const MSG_STATE = "esphome-web-flash:state";
export const MSG_PROGRESS = "esphome-web-flash:progress";

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
  parts: FlashPartMessage[];
}

export type FlashState = "connecting" | "installing" | "done" | "error";

// Sanity caps for the untrusted postMessage payload. A merged ESP factory image
// is a handful of parts totalling a few MB; these ceilings reject absurd frames
// (accidental or hostile) cheaply, before the receiver copies the buffers.
const MAX_FLASH_PARTS = 64;
const MAX_FLASH_BYTES = 64 * 1024 * 1024; // 64 MiB, per part and in total
const MAX_FLASH_ADDRESS = 0x1_0000_0000; // 4 GiB — a 32-bit flash address space

/** Runtime guard for a well-formed, plausibly-sized ``parts`` array. */
export function isFlashParts(parts: unknown): parts is FlashPartMessage[] {
  if (!Array.isArray(parts) || parts.length === 0 || parts.length > MAX_FLASH_PARTS) {
    return false;
  }
  let total = 0;
  for (const p of parts) {
    if (!p || typeof p !== "object") return false;
    const address = (p as { address?: unknown }).address;
    const data = (p as { data?: unknown }).data;
    if (
      typeof address !== "number" ||
      !Number.isInteger(address) ||
      address < 0 ||
      address >= MAX_FLASH_ADDRESS ||
      !(data instanceof ArrayBuffer) ||
      data.byteLength > MAX_FLASH_BYTES
    ) {
      return false;
    }
    total += data.byteLength;
    if (total > MAX_FLASH_BYTES) return false;
  }
  return true;
}
