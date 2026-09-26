/**
 * The Device Builder's browser flashers, one per platform with an in-app
 * compile-then-flash flow. Adding a platform is a new directory whose
 * ``dashboard.ts`` exports a ``BrowserFlasher`` (see
 * ``components/firmware-install-dialog/browser-flasher.ts``) plus one entry
 * here; the install dialog, the method rows and ``applyInstallMethod`` read
 * everything from it. Never imported from ``src/web``.
 */
import type { AnyBrowserFlasher } from "../components/firmware-install-dialog/browser-flasher.js";
import { nrfDfuFlasher } from "./nrf52/dashboard.js";
import { rp2Uf2Flasher } from "./rp2/dashboard.js";
import { rtlAmbz2Flasher } from "./rtl87xx/dashboard.js";

export const BROWSER_FLASHERS: readonly AnyBrowserFlasher[] = [
  nrfDfuFlasher,
  rp2Uf2Flasher,
  rtlAmbz2Flasher,
];

/** The flasher an install method string selects, if any. */
export function browserFlasherForMethod(method: string): AnyBrowserFlasher | undefined {
  return BROWSER_FLASHERS.find((f) => f.id === method);
}

/** The flasher that handles a device's target platform, if any. */
export function browserFlasherForPlatform(
  platform: string | null | undefined
): AnyBrowserFlasher | undefined {
  return BROWSER_FLASHERS.find((f) => f.matches(platform));
}
