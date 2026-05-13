/**
 * Where the backend is running, from the dashboard's perspective.
 *
 * Drives environment-aware copy in the wizard and install dialog —
 * specifically the heading on the server-side serial-port picker
 * and the "plug into …" labels: a user on the HA add-on should
 * read "your Home Assistant server", a user on the Desktop app
 * (or running the backend on their own machine) should read
 * "this computer", and remote-hosted setups fall back to the
 * generic "the computer running the device builder".
 */
import type { ESPHomeAPI } from "../api/index.js";

export type DeploymentEnvironment = "localhost" | "ha-addon" | "remote";

/**
 * Resolve where the backend is running. HA-addon is sourced from
 * the authoritative ``ServerInfoMessage.ha_addon`` flag — the
 * backend sets this from ``settings.on_ha_addon``, which it knows
 * at startup. ``localhost`` is a frontend trick that catches the
 * Desktop app and any user running the backend on their own
 * machine; a future ``desktop_app`` flag on ServerInfoMessage can
 * collapse this branch when it's wired up. Everything else is
 * ``remote``.
 *
 * Call this from any component that consumes ``apiContext``; by
 * the time render is happening the WS handshake is complete and
 * ``serverInfo`` is populated.
 */
export function detectEnvironment(api: ESPHomeAPI): DeploymentEnvironment {
  if (api.serverInfo?.ha_addon) return "ha-addon";
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return "localhost";
    }
  }
  return "remote";
}
