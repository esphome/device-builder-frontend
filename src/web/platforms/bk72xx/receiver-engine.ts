/**
 * The flash receiver's BK72xx engine: the chip's UART downloader, the same
 * the in-app flow and the web BK72xx dialog use.
 */
import { BK72XX_SERIAL_LOGS } from "../../../platforms/bk72xx/index.js";
import { libretinyReceiverEngine } from "../../flash-receiver/libretiny-receiver-engine.js";
import { BK_INSTALL } from "./install.js";

export const bkUartReceiverEngine = libretinyReceiverEngine(
  BK_INSTALL,
  BK72XX_SERIAL_LOGS
);
