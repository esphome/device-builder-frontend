/**
 * The flash receiver's LN882H engine: the chip's UART downloader, the same
 * the in-app flow and the web LN882H dialog use.
 */
import { LN882X_SERIAL_LOGS } from "../../../platforms/ln882x/index.js";
import { libretinyReceiverEngine } from "../../flash-receiver/libretiny-receiver-engine.js";
import { LN_INSTALL } from "./install.js";

export const lnUartReceiverEngine = libretinyReceiverEngine(
  LN_INSTALL,
  LN882X_SERIAL_LOGS
);
