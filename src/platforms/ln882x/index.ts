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

import { getErrorMessage } from "../../util/error-message.js";
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

/**
 * Parse a LibreTiny UF2 with the on-demand parser. A failed chunk fetch,
 * the wrong family and a bad file each name their own copy; never throws.
 */
export async function loadLn882xImage(
  bytes: Uint8Array
): Promise<{ image: LibreTinyImage } | Ln882xImageFailure> {
  let parser: Awaited<ReturnType<typeof loadLn882xParser>>;
  try {
    parser = await loadLn882xParser();
  } catch (err) {
    console.error("[ln882x] Could not load the parser chunk:", err);
    return { key: "firmware.engine_load_failed", detail: getErrorMessage(err) };
  }
  try {
    return { image: parser.parseLn882xImage(bytes) };
  } catch (err) {
    return {
      key: err instanceof parser.Ln882xImageError ? err.key : "firmware.ln_bad_uf2",
      detail: getErrorMessage(err),
    };
  }
}

/**
 * Flash a parsed image through the on-demand engine. ``rebooted`` is false
 * when the chip has to be reset by hand; a failure (the engine chunk, the
 * RAM code, the link, the write) comes back as its detail, with the error,
 * and the RAM code and a failed chunk fetch name their copy. Never throws.
 */
export async function runLn882x(
  port: SerialPort,
  image: LibreTinyImage,
  hooks: Ln882xFlashHooks
): Promise<LibreTinyFlashResult> {
  let engine: Awaited<ReturnType<typeof loadLn882xEngine>>;
  try {
    engine = await loadLn882xEngine();
  } catch (err) {
    console.error("[ln882x] Could not load the engine chunk:", err);
    return {
      detail: getErrorMessage(err),
      error: err,
      key: "firmware.engine_load_failed",
    };
  }
  try {
    return { rebooted: await engine.flashLn882x(port, image, hooks) };
  } catch (err) {
    return {
      detail: getErrorMessage(err),
      error: err,
      ...(err instanceof engine.Ln882xRamcodeError ? { key: err.key } : {}),
    };
  }
}
