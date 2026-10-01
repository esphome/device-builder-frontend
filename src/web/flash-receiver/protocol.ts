/**
 * The receiver's side of the flash hand-off contract: the shared frames and
 * ids from ``src/platforms/handoff.ts`` plus the checks on the untrusted
 * inbound payload.
 */
import type { FlashPartMessage, HandoffLogs } from "../../platforms/handoff.js";

export * from "../../platforms/handoff.js";

// Sanity caps for the untrusted postMessage payload. A merged ESP factory image
// is a handful of parts totalling a few MB; these ceilings reject absurd frames
// (accidental or hostile) cheaply, before the receiver copies the buffers.
const MAX_FLASH_PARTS = 64;
const MAX_FLASH_BYTES = 64 * 1024 * 1024; // 64 MiB, per part and in total
const MAX_FLASH_ADDRESS = 0x1_0000_0000; // 4 GiB — a 32-bit flash address space

/** The inbound ``logs`` field, or undefined for anything that is not one. */
export const handoffLogsOf = (value: unknown): HandoffLogs | undefined =>
  value === "flash-port" || value === "off" ? value : undefined;

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
