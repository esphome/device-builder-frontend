/**
 * The flash receiver's RTL8710B engine: the AmebaZ ROM downloader, the same one
 * the in-app flow and the web RTL8710B dialog use.
 */
import { RTL87XX_SERIAL_LOGS } from "../../../platforms/rtl87xx/index.js";
import { libretinyReceiverEngine } from "../../flash-receiver/libretiny-receiver-engine.js";
import { RTL_AMBZ_INSTALL } from "./ambz-install.js";

export const rtlAmbzReceiverEngine = libretinyReceiverEngine(
  RTL_AMBZ_INSTALL,
  RTL87XX_SERIAL_LOGS
);
