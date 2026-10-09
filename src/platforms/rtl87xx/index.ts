/**
 * RTL8720C (AmebaZ2), RTL8710B (AmebaZ) and RTL8720D (AmebaD) API shared by
 * the Device Builder and web.esphome.io. The ROM-downloader engines and the
 * LibreTiny UF2 parsers are re-exported as types only, and the loaders fetch
 * them on demand.
 */
export type * from "./ambz2-flasher.js";
export type * from "./ambz-flasher.js";
export type * from "./ambz-image.js";
export type * from "./ambd-flasher.js";
export type * from "./ambd-image.js";
export type * from "./rtl87xx-image.js";
export type * from "../libretiny-uf2.js";
export type * from "./ambz2-image.js";
export * from "./rtl87xx-platform.js";
export * from "./serial-logs.js";

import { type ChunkParseFailure, flashWith, parseWith } from "../lazy-chunk.js";
import type { LibreTinyFlashHooks, LibreTinyFlashResult } from "../libretiny-flash.js";
import type { LibreTinyFile, LibreTinyImage } from "../libretiny-uf2.js";
import type { AmbdFlashHooks } from "./ambd-flasher.js";
import type { AmbdImage } from "./ambd-image.js";
import type { AmbzImage } from "./ambz-image.js";
import type { Ambz2FlashHooks } from "./ambz2-flasher.js";
import type { RtlImage } from "./rtl87xx-image.js";

export const loadAmbz2Engine = () => import("./ambz2-flasher.js");
export const loadAmbz2Parser = () => import("./ambz2-image.js");

type RtlImageKey = "firmware.rtl_wrong_family" | "firmware.rtl_bad_uf2";

/** Why a LibreTiny UF2 could not be parsed: the copy for the user and the detail. */
export type RtlImageFailure = ChunkParseFailure<RtlImageKey>;

/** Every parser chunk refuses a file as ``RtlImageError``; anything else is a bad file. */
const rtlKey = (
  parser: Pick<Awaited<ReturnType<typeof loadAmbz2Parser>>, "RtlImageError">,
  err: unknown
): RtlImageKey =>
  err instanceof parser.RtlImageError ? err.key : "firmware.rtl_bad_uf2";

/**
 * Parse a LibreTiny UF2 with the on-demand parser, for every flow that takes
 * one (the in-app install, the web RTL dialog, the flash receiver); never throws.
 */
export const loadAmbz2Image = (
  bytes: Uint8Array
): Promise<{ image: LibreTinyImage } | RtlImageFailure> =>
  parseWith(
    "[rtl87xx]",
    loadAmbz2Parser,
    (p) => ({ image: p.parseAmbz2Image(bytes) }),
    rtlKey
  );

/** ``loadAmbz2Image`` without the flash runs, for a check of the file alone; never throws. */
export const checkAmbz2Image = (
  bytes: Uint8Array
): Promise<{ file: LibreTinyFile } | RtlImageFailure> =>
  parseWith(
    "[rtl87xx]",
    loadAmbz2Parser,
    (p) => ({ file: p.checkAmbz2Uf2(bytes) }),
    rtlKey
  );

/**
 * Flash a parsed image through the on-demand ROM downloader engine, for the
 * same three flows. ``rebooted`` is false when the adapter has no control
 * lines and the user resets the board by hand; never throws.
 */
export const runAmbz2 = (
  port: SerialPort,
  image: LibreTinyImage,
  hooks: Ambz2FlashHooks
): Promise<LibreTinyFlashResult> =>
  flashWith("[rtl87xx]", loadAmbz2Engine, async (e) => ({
    rebooted: await e.flashAmbz2(port, image, hooks),
  }));

export const loadAmbzEngine = () => import("./ambz-flasher.js");
export const loadAmbzParser = () => import("./ambz-image.js");
export const loadRtl87xxParser = () => import("./rtl87xx-image.js");

/** The RTL8710B counterpart of ``loadAmbz2Image``; never throws. */
export const loadAmbzImage = (
  bytes: Uint8Array
): Promise<{ image: AmbzImage } | RtlImageFailure> =>
  parseWith(
    "[rtl87xx AmebaZ]",
    loadAmbzParser,
    (p) => ({ image: p.parseAmbzImage(bytes) }),
    rtlKey
  );

/** ``loadAmbzImage`` without either slot's runs, for a check of the file alone; never throws. */
export const checkAmbzImage = (
  bytes: Uint8Array
): Promise<{ file: LibreTinyFile } | RtlImageFailure> =>
  parseWith(
    "[rtl87xx AmebaZ]",
    loadAmbzParser,
    (p) => ({ file: p.checkAmbzUf2(bytes) }),
    rtlKey
  );

/** Parse an RTL8720C, RTL8710B or RTL8720D UF2 in one pass, naming its chip; never throws. */
export const loadRtl87xxImage = (
  bytes: Uint8Array
): Promise<{ image: RtlImage } | RtlImageFailure> =>
  parseWith(
    "[rtl87xx]",
    loadRtl87xxParser,
    (p) => ({ image: p.parseRtl87xxImage(bytes) }),
    (p, err) => (err instanceof p.RtlImageError ? err.key : "firmware.rtl_bad_uf2")
  );

/** The RTL8710B counterpart of ``runAmbz2``; never throws. */
export const runAmbz = (
  port: SerialPort,
  image: AmbzImage,
  hooks: LibreTinyFlashHooks
): Promise<LibreTinyFlashResult> =>
  flashWith("[rtl87xx AmebaZ]", loadAmbzEngine, async (e) => {
    await e.flashAmbz(port, image, hooks);
    return { rebooted: false };
  });

export const loadAmbdEngine = () => import("./ambd-flasher.js");
export const loadAmbdParser = () => import("./ambd-image.js");

/**
 * The engine chunk and the flash loader it needs, fetched side by side, for
 * a flow to start while the user picks a port: the flash then finds both
 * cached. Rejects with whichever failed; the flash itself names it.
 */
export async function warmAmbd(): Promise<unknown> {
  const [engine] = await Promise.all([
    loadAmbdEngine(),
    import("./ambd-loader.js").then((loader) => loader.loadAmbdLoader()),
  ]);
  return engine;
}

/** The RTL8720D counterpart of ``loadAmbz2Image``; never throws. */
export const loadAmbdImage = (
  bytes: Uint8Array
): Promise<{ image: AmbdImage } | RtlImageFailure> =>
  parseWith(
    "[rtl87xx AmebaD]",
    loadAmbdParser,
    (p) => ({ image: p.parseAmbdImage(bytes) }),
    rtlKey
  );

/** ``loadAmbdImage`` without the flash runs, for a check of the file alone; never throws. */
export const checkAmbdImage = (
  bytes: Uint8Array
): Promise<{ file: LibreTinyFile } | RtlImageFailure> =>
  parseWith(
    "[rtl87xx AmebaD]",
    loadAmbdParser,
    (p) => ({ file: p.checkAmbdUf2(bytes) }),
    rtlKey
  );

/**
 * The RTL8720D counterpart of ``runAmbz2``; never throws. A flash loader
 * that could not be fetched, or was not the expected file, names its own copy.
 */
export const runAmbd = (
  port: SerialPort,
  image: AmbdImage,
  hooks: AmbdFlashHooks
): Promise<LibreTinyFlashResult> =>
  flashWith(
    "[rtl87xx AmebaD]",
    loadAmbdEngine,
    async (e) => ({ rebooted: await e.flashAmbd(port, image, hooks) }),
    (e, err) => (err instanceof e.AmbdLoaderError ? err.key : undefined)
  );
