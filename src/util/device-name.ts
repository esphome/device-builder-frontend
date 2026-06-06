import type { ConfiguredDevice } from "../api/types/devices.js";

/**
 * The backend-resolved ESPHome node name (substitutions already expanded) for
 * the device with this *configuration* id, or `""` when unknown. The hostname
 * for per-device secret keys (`<host>__encryption_key`, `<host>__ota_password`).
 */
export function resolveDeviceName(
  devices: readonly ConfiguredDevice[],
  configuration: string
): string {
  return configuration
    ? (devices.find((d) => d.configuration === configuration)?.name ?? "")
    : "";
}
