/**
 * web.esphome.io's device families, in header order; the first is the
 * default mode. Adding one is a new ``platforms/<name>/`` with a ``mode.ts``
 * exporting its ``WebPlatform`` (see ``web-platform.ts``), its logo in
 * ``public/web/static/logo/``, its copy, and one entry here.
 */
import { espWebMode } from "./esp/mode.js";
import { nrfWebMode } from "./nrf52/mode.js";
import { picoWebMode } from "./rp2/mode.js";
import { rtlWebMode } from "./rtl87xx/mode.js";
import type { WebPlatform } from "./web-platform.js";

export const WEB_PLATFORMS = [espWebMode, picoWebMode, nrfWebMode, rtlWebMode] as const;

export type WebMode = (typeof WEB_PLATFORMS)[number]["mode"];

export const DEFAULT_WEB_MODE: WebMode = WEB_PLATFORMS[0].mode;

/** The family for a mode (the default one for anything unknown). */
export function webPlatform(mode: WebMode): WebPlatform {
  return WEB_PLATFORMS.find((p) => p.mode === mode) ?? WEB_PLATFORMS[0];
}

/**
 * The family a port's USB ids clearly point at, or undefined for a generic
 * UART bridge or an unknown device. The claims use disjoint vendor ids, so
 * the order never decides between two families.
 */
export function webPlatformOfPort(port: SerialPort): WebPlatform<WebMode> | undefined {
  return WEB_PLATFORMS.find((p) => p.claimsPort?.(port));
}
