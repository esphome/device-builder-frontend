/**
 * The Device Builder's platforms beyond ESP, one ``PlatformSupport`` each
 * (see ``platform-support.ts``). Adding a platform is a new directory whose
 * ``dashboard.ts`` exports its descriptor plus one entry here; the install
 * dialog, the method rows, ``applyInstallMethod`` and the logs code read
 * everything from it. A device with no entry (ESP) gets the built-in
 * behaviour. Never imported from ``src/web``.
 */
import type { ConfiguredDevice } from "../api/types/devices.js";
import { bk72xxPlatform } from "./bk72xx/dashboard.js";
import { ESP_SERIAL_LOGS } from "./esp/serial-logs.js";
import { ln882xPlatform } from "./ln882x/dashboard.js";
import { nrf52Platform } from "./nrf52/dashboard.js";
import type { AnyBrowserInstall, PlatformSupport } from "./platform-support.js";
import { rp2Platform } from "./rp2/dashboard.js";
import { rtl87xxPlatform } from "./rtl87xx/dashboard.js";
import type { SerialLogsPolicy } from "./serial-logs.js";

export const PLATFORMS: readonly PlatformSupport[] = [
  nrf52Platform,
  rp2Platform,
  rtl87xxPlatform,
  bk72xxPlatform,
  ln882xPlatform,
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

/** What a flasher is matched against: the device's chip and its bootloader. */
export type DeviceHardware = Pick<ConfiguredDevice, "mcu" | "bootloader">;

const writesChip = (install: AnyBrowserInstall, mcu: string | null): boolean =>
  !install.chips || (mcu !== null && install.chips.includes(mcu));

const speaksBootloader = (
  install: AnyBrowserInstall,
  bootloader: string | null
): boolean =>
  !install.bootloaders ||
  (bootloader !== null && install.bootloaders.includes(bootloader));

const writesDevice = (install: AnyBrowserInstall, hardware: DeviceHardware): boolean =>
  writesChip(install, hardware.mcu) && speaksBootloader(install, hardware.bootloader);

/**
 * The flasher of ``platform`` that writes a device's chip, through its
 * bootloader, whatever firmware it runs, if one does.
 */
export function installOf(
  platform: PlatformSupport | undefined,
  hardware: DeviceHardware
): AnyBrowserInstall | undefined {
  return platform?.installs?.find(
    (install) => !install.component && writesDevice(install, hardware)
  );
}

/** Every flasher a device can take: its chip's, and its firmware's own. */
export function installsFor(
  device: ConfiguredDevice | null | undefined
): readonly AnyBrowserInstall[] {
  if (!device) return [];
  return (platformFor(device.target_platform)?.installs ?? []).filter(
    (install) =>
      writesDevice(install, device) &&
      (!install.component || device.loaded_platforms.includes(install.component))
  );
}

/** The install flow an install method string selects, if any. */
export function installForMethod(method: string): AnyBrowserInstall | undefined {
  return PLATFORMS.flatMap((p) => p.installs ?? []).find((i) => i.id === method);
}
