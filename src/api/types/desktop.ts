/**
 * Payload types for the ESPHome Desktop update commands (`desktop/check_update`,
 * `desktop/update`). Available only when the handshake reports
 * `ServerInfoMessage.desktop_update_capable` (the desktop app 0.14.0+).
 */

/** One component's update availability, from `desktop/check_update`. */
export interface DesktopComponentUpdate {
  available: boolean;
  installed: string | null;
  latest: string | null;
  error: string | null;
}

/** Result of `desktop/check_update`: per-component update availability. */
export interface DesktopUpdateCheck {
  any_available: boolean;
  /** The desktop app itself (its self-update from GitHub Releases). */
  app: DesktopComponentUpdate;
  esphome: DesktopComponentUpdate;
  device_builder: DesktopComponentUpdate;
}

/** Result of `desktop/update`: the update was spawned (the app then restarts). */
export interface DesktopUpdateStarted {
  started: boolean;
}
