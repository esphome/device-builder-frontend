/**
 * The Device Builder's platforms beyond ESP, one ``PlatformSupport`` each
 * (see ``platform-support.ts``). Adding a platform is a new directory whose
 * ``dashboard.ts`` exports its descriptor plus one entry here; the install
 * dialog, the method rows, ``applyInstallMethod`` and the logs code read
 * everything from it. A device with no entry (ESP) gets the built-in
 * behaviour. Never imported from ``src/web``.
 */
import { ESP_SERIAL_LOGS } from "./esp/serial-logs.js";
import { nrf52Platform } from "./nrf52/dashboard.js";
import type { AnyBrowserInstall, PlatformSupport } from "./platform-support.js";
import { rp2Platform } from "./rp2/dashboard.js";
import { rtl87xxPlatform } from "./rtl87xx/dashboard.js";
import type { SerialLogsPolicy } from "./serial-logs.js";

export const PLATFORMS: readonly PlatformSupport[] = [
  nrf52Platform,
  rp2Platform,
  rtl87xxPlatform,
];

/** The descriptor for a device's target platform, if any. */
export function platformFor(
  targetPlatform: string | null | undefined
): PlatformSupport | undefined {
  return PLATFORMS.find((p) => p.matches(targetPlatform));
}

/**
 * A platform's Web Serial logs policy: ESP's for a device with no descriptor
 * (ESP has none), and none at all for a platform without serial logs.
 */
export function serialLogsOf(platform: PlatformSupport | undefined): SerialLogsPolicy {
  return platform ? (platform.logs?.serial ?? {}) : ESP_SERIAL_LOGS;
}

/** ``serialLogsOf`` for a device's target platform. */
export function serialLogsFor(
  targetPlatform: string | null | undefined
): SerialLogsPolicy {
  return serialLogsOf(platformFor(targetPlatform));
}

/** The flasher of ``platform`` that writes a device's chip, if one does. */
export function installOf(
  platform: PlatformSupport | undefined,
  mcu: string | null
): AnyBrowserInstall | undefined {
  return platform?.installs?.find(
    (install) => !install.chips || (mcu !== null && install.chips.includes(mcu))
  );
}

/** ``installOf`` for a device's target platform. */
export function installFor(
  targetPlatform: string | null | undefined,
  mcu: string | null
): AnyBrowserInstall | undefined {
  return installOf(platformFor(targetPlatform), mcu);
}

/** The install flow an install method string selects, if any. */
export function installForMethod(method: string): AnyBrowserInstall | undefined {
  return PLATFORMS.flatMap((p) => p.installs ?? []).find((i) => i.id === method);
}
