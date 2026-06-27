import type { LocalizeFunc } from "../common/localize.js";

/**
 * Hover text for an Update button: installed → target ESPHome version, restoring
 * the legacy dashboard tooltip. `installed` is the device's `deployed_version`
 * (running firmware), `target` its `current_version` (what an update installs).
 * Falls back to the button's own label when either version is unknown.
 */
export function updateButtonTitle(
  localize: LocalizeFunc,
  installed: string,
  target: string,
  fallbackKey: string
): string {
  return installed && target
    ? localize("dashboard.update_available_version", { installed, target })
    : localize(fallbackKey);
}
