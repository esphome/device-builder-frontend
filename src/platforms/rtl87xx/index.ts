/**
 * RTL8720C (AmebaZ2) and RTL8710B (AmebaZ) API shared by the Device Builder
 * and web.esphome.io. The ROM-downloader engines and the LibreTiny UF2
 * parsers are re-exported as types only, and the loaders fetch them on demand.
 */
export type * from "./ambz2-flasher.js";
export type * from "./ambz-flasher.js";
export type * from "./ambz-image.js";
export type * from "../libretiny-uf2.js";
export type * from "./ambz2-image.js";
export * from "./rtl87xx-platform.js";
export * from "./serial-logs.js";

import { getErrorMessage } from "../../util/error-message.js";
import type { LibreTinyFlashHooks, LibreTinyFlashResult } from "../libretiny-flash.js";
import type { LibreTinyImage } from "../libretiny-uf2.js";
import type { AmbzImage, RtlImage } from "./ambz-image.js";
import type { Ambz2FlashHooks } from "./ambz2-flasher.js";

export const loadAmbz2Engine = () => import("./ambz2-flasher.js");
export const loadAmbz2Parser = () => import("./ambz2-image.js");

/** Why a LibreTiny UF2 could not be parsed: the copy for the user and the detail. */
export interface RtlImageFailure {
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
): Promise<{ image: LibreTinyImage } | RtlImageFailure> {
  let parser: Awaited<ReturnType<typeof loadAmbz2Parser>>;
  try {
    parser = await loadAmbz2Parser();
  } catch (err) {
    console.error("[rtl87xx] Could not load the parser chunk:", err);
    return { key: "firmware.engine_load_failed", detail: getErrorMessage(err) };
  }
  try {
    return { image: parser.parseAmbz2Image(bytes) };
  } catch (err) {
    return {
      key: err instanceof parser.RtlImageError ? err.key : "firmware.rtl_bad_uf2",
      detail: getErrorMessage(err),
    };
  }
}

/**
 * Flash a parsed image through the on-demand ROM downloader engine, for the
 * same three flows. ``rebooted`` is false when the adapter has no control
 * lines and the user resets the board by hand; a failure (the engine chunk,
 * the link, the write) comes back as its detail, with the error for a flow
 * that has a line of its own for it, and a failed chunk fetch names its
 * copy. Never throws.
 */
export async function runAmbz2(
  port: SerialPort,
  image: LibreTinyImage,
  hooks: Ambz2FlashHooks
): Promise<LibreTinyFlashResult> {
  let engine: Awaited<ReturnType<typeof loadAmbz2Engine>>;
  try {
    engine = await loadAmbz2Engine();
  } catch (err) {
    console.error("[rtl87xx] Could not load the engine chunk:", err);
    return {
      detail: getErrorMessage(err),
      error: err,
      key: "firmware.engine_load_failed",
    };
  }
  try {
    return { rebooted: await engine.flashAmbz2(port, image, hooks) };
  } catch (err) {
    return { detail: getErrorMessage(err), error: err };
  }
}

export const loadAmbzEngine = () => import("./ambz-flasher.js");
export const loadAmbzParser = () => import("./ambz-image.js");

/** The RTL8710B counterpart of ``loadAmbz2Image``; never throws. */
export async function loadAmbzImage(
  bytes: Uint8Array
): Promise<{ image: AmbzImage } | RtlImageFailure> {
  let parser: Awaited<ReturnType<typeof loadAmbzParser>>;
  try {
    parser = await loadAmbzParser();
  } catch (err) {
    console.error("[rtl87xx] Could not load the AmebaZ parser chunk:", err);
    return { key: "firmware.engine_load_failed", detail: getErrorMessage(err) };
  }
  try {
    return { image: parser.parseAmbzImage(bytes) };
  } catch (err) {
    return {
      key: err instanceof parser.RtlImageError ? err.key : "firmware.rtl_bad_uf2",
      detail: getErrorMessage(err),
    };
  }
}

/** Parse an RTL8720C or RTL8710B UF2 in one pass, naming its chip; never throws. */
export async function loadRtl87xxImage(
  bytes: Uint8Array
): Promise<{ image: RtlImage } | RtlImageFailure> {
  let parser: Awaited<ReturnType<typeof loadAmbzParser>>;
  try {
    parser = await loadAmbzParser();
  } catch (err) {
    console.error("[rtl87xx] Could not load the RTL87xx parser chunk:", err);
    return { key: "firmware.engine_load_failed", detail: getErrorMessage(err) };
  }
  try {
    return { image: parser.parseRtl87xxImage(bytes) };
  } catch (err) {
    return {
      key: err instanceof parser.RtlImageError ? err.key : "firmware.rtl_bad_uf2",
      detail: getErrorMessage(err),
    };
  }
}

/** The RTL8710B counterpart of ``runAmbz2``; never throws. */
export async function runAmbz(
  port: SerialPort,
  image: AmbzImage,
  hooks: LibreTinyFlashHooks
): Promise<LibreTinyFlashResult> {
  let engine: Awaited<ReturnType<typeof loadAmbzEngine>>;
  try {
    engine = await loadAmbzEngine();
  } catch (err) {
    console.error("[rtl87xx] Could not load the AmebaZ engine chunk:", err);
    return {
      detail: getErrorMessage(err),
      error: err,
      key: "firmware.engine_load_failed",
    };
  }
  try {
    await engine.flashAmbz(port, image, hooks);
    return { rebooted: false };
  } catch (err) {
    return { detail: getErrorMessage(err), error: err };
  }
}
