/**
 * LN882H API shared by the Device Builder and web.esphome.io. The UART
 * downloader engine and the LibreTiny UF2 parser are re-exported as types
 * only, and the loaders fetch them on demand.
 */
export type * from "./ln882x-flasher.js";
export type * from "../libretiny-uf2.js";
export type * from "./ln882x-image.js";
export * from "./ln882x-platform.js";
export * from "./serial-logs.js";

import { flashWith, parseWith } from "../lazy-chunk.js";
import type { LibreTinyFlashResult } from "../libretiny-flash.js";
import type { LibreTinyImage } from "../libretiny-uf2.js";
import type { Ln882xFlashHooks } from "./ln882x-flasher.js";

export const loadLn882xEngine = () => import("./ln882x-flasher.js");
export const loadLn882xParser = () => import("./ln882x-image.js");

/**
 * The engine chunk and the RAM code it needs, fetched side by side, for a
 * flow to start while the user picks a port: the flash then finds both
 * cached. Rejects with whichever failed; the flash itself names it.
 */
export async function warmLn882x(): Promise<unknown> {
  const [engine] = await Promise.all([
    loadLn882xEngine(),
    import("./ln882x-ramcode.js").then((ramcode) => ramcode.loadRamcode()),
  ]);
  return engine;
}

/** Why a LibreTiny UF2 could not be parsed: the copy for the user and the detail. */
export interface Ln882xImageFailure {
  key: "firmware.engine_load_failed" | "firmware.ln_wrong_family" | "firmware.ln_bad_uf2";
  detail: string;
}

/** Parse a LibreTiny UF2 with the on-demand parser; never throws. */
export const loadLn882xImage = (
  bytes: Uint8Array
): Promise<{ image: LibreTinyImage } | Ln882xImageFailure> =>
  parseWith(
    "[ln882x]",
    loadLn882xParser,
    (p) => ({ image: p.parseLn882xImage(bytes) }),
    (p, err) => (err instanceof p.Ln882xImageError ? err.key : "firmware.ln_bad_uf2")
  );

/**
 * Flash a parsed image through the on-demand engine. ``rebooted`` is false
 * when the chip has to be reset by hand; the RAM code names its own copy.
 * Never throws.
 */
export const runLn882x = (
  port: SerialPort,
  image: LibreTinyImage,
  hooks: Ln882xFlashHooks
): Promise<LibreTinyFlashResult> =>
  flashWith(
    "[ln882x]",
    loadLn882xEngine,
    async (e) => ({ rebooted: await e.flashLn882x(port, image, hooks) }),
    (e, err) => (err instanceof e.Ln882xRamcodeError ? { key: err.key } : {})
  );
