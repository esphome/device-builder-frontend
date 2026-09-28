/**
 * The flash receiver's RTL8720C engine: the AmebaZ2 ROM downloader, the same
 * the in-app flow and the web RTL dialog use. The RTL8710B is not this
 * engine: its ROM speaks another protocol and gets its own id and module.
 */
import { RTL87XX_SERIAL_LOGS } from "../../../platforms/rtl87xx/index.js";
import { libretinyReceiverEngine } from "../../flash-receiver/libretiny-receiver-engine.js";
import { RTL_INSTALL } from "./install.js";

export const rtlAmbz2ReceiverEngine = libretinyReceiverEngine(
  RTL_INSTALL,
  RTL87XX_SERIAL_LOGS
);
