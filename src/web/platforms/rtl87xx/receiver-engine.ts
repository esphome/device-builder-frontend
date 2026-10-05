/**
 * The flash receiver's RTL8720C engine: the AmebaZ2 ROM downloader, the same one
 * the in-app flow and the web RTL dialog use.
 */
import { RTL87XX_SERIAL_LOGS } from "../../../platforms/rtl87xx/index.js";
import { libretinyReceiverEngine } from "../../flash-receiver/libretiny-receiver-engine.js";
import { RTL_AMBZ2_INSTALL } from "./ambz2-install.js";

export const rtlAmbz2ReceiverEngine = libretinyReceiverEngine(
  RTL_AMBZ2_INSTALL,
  RTL87XX_SERIAL_LOGS
);
