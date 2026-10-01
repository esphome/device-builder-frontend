/**
 * Beken BK72xx API shared by the Device Builder and web.esphome.io. The
 * UART engine and the LibreTiny UF2 parser are re-exported as types only,
 * and the loaders fetch them on demand.
 */
export type * from "../libretiny-uf2.js";
export type * from "./beken-flasher.js";
export type * from "./beken-image.js";
export * from "./bk72xx-platform.js";
export * from "./serial-logs.js";

import { getErrorMessage } from "../../util/error-message.js";
import type { LibreTinyImage } from "../libretiny-uf2.js";
import type { BekenFlashHooks } from "./beken-flasher.js";

export const loadBekenEngine = () => import("./beken-flasher.js");
export const loadBekenParser = () => import("./beken-image.js");

/** Why a LibreTiny UF2 could not be parsed: the copy for the user and the detail. */
export interface BekenImageFailure {
  key: "firmware.engine_load_failed" | "firmware.bk_wrong_family" | "firmware.bk_bad_uf2";
  detail: string;
}

/**
 * Parse a LibreTiny UF2 with the on-demand parser, for every flow that
 * takes one. A failed chunk fetch, the wrong family and a bad file each
 * name their own copy; never throws.
 */
export async function loadBekenImage(
  bytes: Uint8Array
): Promise<{ image: LibreTinyImage } | BekenImageFailure> {
  let parser: Awaited<ReturnType<typeof loadBekenParser>>;
  try {
    parser = await loadBekenParser();
  } catch (err) {
    console.error("[bk72xx] Could not load the parser chunk:", err);
    return { key: "firmware.engine_load_failed", detail: getErrorMessage(err) };
  }
  try {
    return { image: parser.parseBekenImage(bytes) };
  } catch (err) {
    return {
      key: err instanceof parser.BekenImageError ? err.key : "firmware.bk_bad_uf2",
      detail: getErrorMessage(err),
    };
  }
}

/** What ended a flash: its detail, the error, and the copy of its own where it has one. */
export interface BekenFlashFailure {
  detail: string;
  error: unknown;
  key?:
    | "firmware.engine_load_failed"
    | "firmware.bk_wrong_chip"
    | "firmware.bk_unknown_flash"
    | "firmware.bk_no_bootloader";
}

/**
 * Flash a parsed image through the on-demand UART engine, for the same
 * flows. A failure (the engine chunk, the link, the write) comes back as
 * its detail, with the error for a flow that has a line of its own for it.
 * Never throws.
 */
export async function runBeken(
  port: SerialPort,
  image: LibreTinyImage,
  hooks: BekenFlashHooks
): Promise<{ rebooted: true } | BekenFlashFailure> {
  let engine: Awaited<ReturnType<typeof loadBekenEngine>>;
  try {
    engine = await loadBekenEngine();
  } catch (err) {
    console.error("[bk72xx] Could not load the engine chunk:", err);
    return {
      detail: getErrorMessage(err),
      error: err,
      key: "firmware.engine_load_failed",
    };
  }
  try {
    await engine.flashBeken(port, image, hooks);
    // The reboot is a command, so it needs no line of the adapter.
    return { rebooted: true };
  } catch (err) {
    const key =
      err instanceof engine.BekenChipMismatchError
        ? "firmware.bk_wrong_chip"
        : err instanceof engine.BekenUnknownFlashError
          ? "firmware.bk_unknown_flash"
          : err instanceof engine.BekenNoBootloaderError
            ? "firmware.bk_no_bootloader"
            : undefined;
    return { detail: getErrorMessage(err), error: err, key };
  }
}
