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

/**
 * Visible label / aria-label for an install-or-update affordance: the
 * view-progress string while a job runs (the click re-attaches to it),
 * the idle key otherwise.
 */
export function busyActionLabel(
  localize: LocalizeFunc,
  busy: boolean,
  idleKey: string
): string {
  return localize(busy ? "dashboard.table_action_view_progress" : idleKey);
}

/**
 * Title for an Update action button: the view-progress hint while a job
 * runs (the click re-attaches to it), the update tooltip otherwise.
 */
export function updateActionTitle(
  localize: LocalizeFunc,
  busy: boolean,
  installed: string,
  target: string,
  fallbackKey: string
): string {
  return busy
    ? localize("dashboard.table_action_view_progress")
    : updateButtonTitle(localize, installed, target, fallbackKey);
}
