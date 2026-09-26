/**
 * RTL8720C (AmebaZ2) API shared by the Device Builder and web.esphome.io. The
 * ROM-downloader engine and the LibreTiny UF2 parser stay out of the main
 * chunk: only their types are re-exported, and the loaders fetch them on
 * demand.
 */
export type * from "./ambz2-flasher.js";
export type * from "./libretiny-uf2.js";
export * from "./rtl87xx-platform.js";

export const loadAmbz2Engine = () => import("./ambz2-flasher.js");
export const loadLibreTinyParser = () => import("./libretiny-uf2.js");
