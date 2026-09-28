/**
 * web.esphome.io's device families, in header order; the first is the
 * default mode. Adding one is a new ``platforms/<name>/`` with a ``mode.ts``
 * exporting its ``WebPlatform`` (see ``web-platform.ts``), its logo in
 * ``public/web/static/logo/``, its copy, and one entry here.
 */
import { portFamily } from "../../platforms/port-family.js";
import { bkWebMode } from "./bk72xx/mode.js";
import { espWebMode } from "./esp/mode.js";
import { nrfWebMode } from "./nrf52/mode.js";
import { picoWebMode } from "./rp2/mode.js";
import { rtlWebMode } from "./rtl87xx/mode.js";
import type { WebPlatform } from "./web-platform.js";

export const WEB_PLATFORMS = [
  espWebMode,
  picoWebMode,
  nrfWebMode,
  rtlWebMode,
  bkWebMode,
] as const;

export type WebMode = (typeof WEB_PLATFORMS)[number]["mode"];

export const DEFAULT_WEB_MODE: WebMode = WEB_PLATFORMS[0].mode;

/** The family for a mode; the default one if the mode was set to anything else. */
export function webPlatform(mode: WebMode): WebPlatform<WebMode> {
  return WEB_PLATFORMS.find((p) => p.mode === mode) ?? WEB_PLATFORMS[0];
}

/**
 * The mode whose family ``portFamily`` names for a port, or undefined for a
 * UART bridge or an unknown device.
 */
export function webPlatformOfPort(port: SerialPort): WebPlatform<WebMode> | undefined {
  const family = portFamily(port);
  return family && WEB_PLATFORMS.find((p) => p.flowSwitch?.family === family);
}
