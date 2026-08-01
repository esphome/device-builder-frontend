import type { ESPHomeAPI } from "../api/index.js";

/**
 * The bug-form installation dropdown value for this deployment; ""
 * when unknown (the desktop app, or before the handshake populates
 * serverInfo) so the value isn't guessed.
 */
export function detectInstallation(api: ESPHomeAPI, isHaAddon: boolean): string {
  if (isHaAddon) return "Home Assistant Add-on";
  const info = api.serverInfo;
  if (!info || info.desktop_version || info.in_docker === undefined) return "";
  return info.in_docker ? "Docker" : "pip";
}
