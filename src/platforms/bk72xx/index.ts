/**
 * Beken BK72xx API shared by the Device Builder and web.esphome.io. The
 * UART engine and the LibreTiny UF2 parser are re-exported as types only,
 * and the loaders fetch them on demand.
 */
export type * from "../libretiny-uf2.js";
export type * from "./beken-flasher.js";
export type * from "./beken-image.js";
export { BEKEN_FAMILIES } from "./beken-families.js";
export * from "./bk72xx-platform.js";
export * from "./serial-logs.js";

import {
  type ChunkFlashFailure,
  type ChunkParseFailure,
  flashWith,
  parseWith,
} from "../lazy-chunk.js";
import type { LinkedImageSource } from "../libretiny-flash.js";
import type { LibreTinyFile, LibreTinyImage } from "../libretiny-uf2.js";
import type { BekenFlashHooks } from "./beken-flasher.js";

export const loadBekenEngine = () => import("./beken-flasher.js");
export const loadBekenParser = () => import("./beken-image.js");

type BekenImageKey = "firmware.bk_wrong_family" | "firmware.bk_bad_uf2";

/** Why a LibreTiny UF2 could not be parsed: the copy for the user and the detail. */
export type BekenImageFailure = ChunkParseFailure<BekenImageKey>;

/** The parser refuses a file as ``BekenImageError``; anything else is a bad file. */
const bekenImageKey = (
  parser: Awaited<ReturnType<typeof loadBekenParser>>,
  err: unknown
): BekenImageKey =>
  err instanceof parser.BekenImageError ? err.key : "firmware.bk_bad_uf2";

/** Parse a LibreTiny UF2 with the on-demand parser, for every flow that takes one; never throws. */
export const loadBekenImage = (
  bytes: Uint8Array
): Promise<{ image: LibreTinyImage } | BekenImageFailure> =>
  parseWith(
    "[bk72xx]",
    loadBekenParser,
    (p) => ({ image: p.parseBekenImage(bytes) }),
    bekenImageKey
  );

/** ``loadBekenImage`` without the flash runs, for a check of the file alone; never throws. */
export const checkBekenImage = (
  bytes: Uint8Array
): Promise<{ file: LibreTinyFile } | BekenImageFailure> =>
  parseWith(
    "[bk72xx]",
    loadBekenParser,
    (p) => ({ file: p.checkBekenUf2(bytes) }),
    bekenImageKey
  );

type BekenFlashKey =
  "firmware.bk_wrong_chip" | "firmware.bk_unknown_flash" | "firmware.bk_no_bootloader";

/** What ended a flash: its detail, the error, and the copy of its own where it has one. */
export type BekenFlashFailure = ChunkFlashFailure<BekenFlashKey>;

/** The engine's own failures and their copy; anything else has none. */
const bekenKey = (
  engine: Awaited<ReturnType<typeof loadBekenEngine>>,
  err: unknown
): BekenFlashKey | undefined =>
  err instanceof engine.BekenChipMismatchError
    ? "firmware.bk_wrong_chip"
    : err instanceof engine.BekenUnknownFlashError
      ? "firmware.bk_unknown_flash"
      : err instanceof engine.BekenNoBootloaderError
        ? "firmware.bk_no_bootloader"
        : undefined;

/**
 * Flash a parsed image, or the one ``image`` gives for the linked chip,
 * through the on-demand UART engine, for the same flows; never throws.
 */
export const runBeken = (
  port: SerialPort,
  image: LibreTinyImage | LinkedImageSource<LibreTinyImage>,
  hooks: BekenFlashHooks
): Promise<{ rebooted: true } | BekenFlashFailure> =>
  flashWith(
    "[bk72xx]",
    loadBekenEngine,
    async (e) => {
      await e.flashBeken(port, image, hooks);
      // The reboot is a command, so it needs no line of the adapter.
      return { rebooted: true } as const;
    },
    bekenKey
  );
