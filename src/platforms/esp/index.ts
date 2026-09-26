/**
 * ESP API shared by the Device Builder and web.esphome.io. esptool-js stays
 * out of both main chunks: the engine is re-exported as types only, and
 * ``loadEsptool`` fetches it once a detect or a flash starts (pick the port
 * first, in the click; the load must not eat the user activation).
 */
export * from "./esp-usb.js";
export * from "./esptool-platform.js";
export type * from "./esptool.js";
export * from "./serial-logs.js";

export const loadEsptool = () => import("./esptool.js");
/** The loaded engine. */
export type Esptool = Awaited<ReturnType<typeof loadEsptool>>;
