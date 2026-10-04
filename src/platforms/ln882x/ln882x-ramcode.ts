/**
 * The LN882H's second stage: the BootROM cannot write flash, so the host
 * first loads Lightning's RAM code over YMODEM and talks to that. The file
 * is not ours to redistribute (it carries no licence), so it is fetched at
 * flash time from the ltchiptool release that ships it and checked against
 * the hash of that release before it goes near a chip.
 */
import { getErrorMessage } from "../../util/error-message.js";

/** ltchiptool 4.14.4's copy, served by jsDelivr from the tagged GitHub tree. */
export const LN882H_RAMCODE_URL =
  "https://cdn.jsdelivr.net/gh/libretiny-eu/ltchiptool@v4.14.4/ltchiptool/soc/ln882h/util/ramcode.bin";
export const LN882H_RAMCODE_SHA256 =
  "6bd437c6f8366b9cca0fb8de0c80c70788516e3681c6c43d654512feb7a0c723";

/** The RAM code could not be fetched, or it is not the file the hash names. */
export class Ln882xRamcodeError extends Error {
  constructor(
    readonly key: "firmware.ln_ramcode_unavailable" | "firmware.ln_ramcode_mismatch",
    message: string
  ) {
    super(message);
    this.name = "Ln882xRamcodeError";
  }
}

let cached: Promise<Uint8Array<ArrayBuffer>> | undefined;

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

async function fetchRamcode(): Promise<Uint8Array<ArrayBuffer>> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const response = await fetch(LN882H_RAMCODE_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (err) {
    throw new Ln882xRamcodeError(
      "firmware.ln_ramcode_unavailable",
      `Could not download the LN882H RAM code: ${getErrorMessage(err)}`
    );
  }
  const digest = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
  if (digest !== LN882H_RAMCODE_SHA256) {
    throw new Ln882xRamcodeError(
      "firmware.ln_ramcode_mismatch",
      `The LN882H RAM code does not match its expected hash (got ${digest})`
    );
  }
  return bytes;
}

/**
 * The RAM code, fetched once per page and only when its hash matches. A
 * failed fetch is forgotten so that Retry fetches again.
 */
export function loadRamcode(): Promise<Uint8Array<ArrayBuffer>> {
  cached ??= fetchRamcode().catch((err: unknown) => {
    cached = undefined;
    throw err;
  });
  return cached;
}

/** Forget the fetched copy; for tests. */
export function resetRamcodeCache(): void {
  cached = undefined;
}
