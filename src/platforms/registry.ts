/**
 * The Device Builder's platforms beyond ESP, one ``PlatformSupport`` each
 * (see ``platform-support.ts``). Adding a platform is a new directory whose
 * ``dashboard.ts`` exports its descriptor plus one entry here; the install
 * dialog, the method rows, ``applyInstallMethod``, the logs code and the
 * board detection read everything from it. A device with no entry (ESP)
 * gets the built-in behaviour. Never imported from ``src/web``.
 *
 * The order is also the order the bridge probes run in after esptool: each
 * probe resets the board it asks, so the harmless ones go first (esptool's
 * DTR/RTS dance is harmless to all of them, which is why it leads).
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

/**
 * Ask each platform with a probe, in order, whether its board is behind a
 * UART bridge port that no ESP answered on: the platform and its chip, or
 * null when none answered.
 */
export async function probeBridgePort(
  port: SerialPort
): Promise<{ platform: string; mcu: string } | null> {
  for (const platform of PLATFORMS) {
    const mcu = platform.probeBridgePort ? await platform.probeBridgePort(port) : null;
    if (mcu) return { platform: platform.id, mcu };
  }
  return null;
}

/** The install flow an install method string selects, if any. */
export function installForMethod(method: string): AnyBrowserInstall | undefined {
  return PLATFORMS.find((p) => p.install?.id === method)?.install;
}
