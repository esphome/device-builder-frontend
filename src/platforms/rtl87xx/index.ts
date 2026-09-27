/**
 * RTL8720C (AmebaZ2) API shared by the Device Builder and web.esphome.io. The
 * ROM-downloader engine and the LibreTiny UF2 parser are re-exported as types
 * only, and the loaders fetch them on demand.
 */
export type * from "./ambz2-flasher.js";
export type * from "./libretiny-uf2.js";
export * from "./rtl87xx-platform.js";
export * from "./serial-logs.js";

import { getErrorMessage } from "../../util/error-message.js";
import type { LibreTinyImage } from "./libretiny-uf2.js";

export const loadAmbz2Engine = () => import("./ambz2-flasher.js");
export const loadLibreTinyParser = () => import("./libretiny-uf2.js");

/** Why a LibreTiny UF2 could not be parsed: the copy for the user and the detail. */
export interface Ambz2ImageFailure {
  key:
    "firmware.engine_load_failed" | "firmware.rtl_wrong_family" | "firmware.rtl_bad_uf2";
  detail: string;
}

/**
 * Parse a LibreTiny UF2 with the on-demand parser, for every flow that takes
 * one (the in-app install, the web RTL dialog, the flash receiver). A failed
 * chunk fetch, the wrong family and a bad file each name their own copy;
 * never throws.
 */
export async function loadAmbz2Image(
  bytes: Uint8Array
): Promise<{ image: LibreTinyImage } | Ambz2ImageFailure> {
  let parser: Awaited<ReturnType<typeof loadLibreTinyParser>>;
  try {
    parser = await loadLibreTinyParser();
  } catch (err) {
    return { key: "firmware.engine_load_failed", detail: getErrorMessage(err) };
  }
  try {
    return { image: parser.parseAmbz2Image(bytes) };
  } catch (err) {
    return {
      key: err instanceof parser.Ambz2ImageError ? err.key : "firmware.rtl_bad_uf2",
      detail: getErrorMessage(err),
    };
  }
}
