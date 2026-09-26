/**
 * The one ``import()`` of the esptool-js engine. Its own module so the
 * helpers that use it (``esp-detect.ts``) reach it through an import a test
 * can replace.
 */
export const loadEsptool = () => import("./esptool.js");

/** The loaded engine. */
export type Esptool = Awaited<ReturnType<typeof loadEsptool>>;
