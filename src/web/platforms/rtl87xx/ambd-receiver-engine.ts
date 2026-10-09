/**
 * The flash receiver's RTL8720D engine: the AmebaD ROM downloader and its
 * flash loader, the same ones the in-app flow and the web RTL dialog use.
 */
import { RTL87XX_SERIAL_LOGS } from "../../../platforms/rtl87xx/index.js";
import { libretinyReceiverEngine } from "../../flash-receiver/libretiny-receiver-engine.js";
import { RTL_AMBD_INSTALL } from "./ambd-install.js";

export const rtlAmbdReceiverEngine = libretinyReceiverEngine(
  RTL_AMBD_INSTALL,
  RTL87XX_SERIAL_LOGS
);
