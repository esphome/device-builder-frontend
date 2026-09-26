/**
 * RTL8720C (AmebaZ2) API shared by the Device Builder and web.esphome.io. The
 * ROM-downloader engine and the LibreTiny UF2 parser are re-exported as types
 * only, and the loaders fetch them on demand. The Device Builder's install
 * flow (``ambz2-install.ts``) still imports the parser statically.
 */
export type * from "./ambz2-flasher.js";
export type * from "./libretiny-uf2.js";
export * from "./rtl87xx-platform.js";
export * from "./serial-logs.js";

export const loadAmbz2Engine = () => import("./ambz2-flasher.js");
export const loadLibreTinyParser = () => import("./libretiny-uf2.js");
