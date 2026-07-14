import { html, nothing, type TemplateResult } from "lit";
import type { PairingWindowState } from "../../api/types/remote-build.js";
import type { LocalizeFunc } from "../../common/localize.js";

/** ``127.4`` → ``2:07`` for the countdown chip. */
export function formatWindowDuration(seconds: number | null): string {
  if (seconds === null) return "";
  const whole = Math.floor(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Open/closed pill + live countdown + Extend for the receiver pairing window.
 *
 * Pair with ``pairingWindowStyles`` and a ``PairingWindowController`` feeding
 * *remaining*.
 */
export function renderPairingWindowStatus(
  localize: LocalizeFunc,
  state: PairingWindowState | null,
  remaining: number | null,
  onExtend: () => void
): TemplateResult | typeof nothing {
  if (state === null) return nothing;
  if (!state.open) {
    return html`
      <span class="pairing-window-pill pairing-window-closed">
        ${localize("settings.build_server_pairing_window_closed")}
      </span>
    `;
  }
  return html`
    <span class="pairing-window-pill pairing-window-open">
      ${localize("settings.build_server_pairing_window_open")}
    </span>
    ${
      remaining !== null
        ? html`
            <span
              class="pairing-window-countdown"
              aria-label=${localize(
                "settings.build_server_pairing_window_remaining_aria",
                { duration: formatWindowDuration(remaining) }
              )}
            >
              ${formatWindowDuration(remaining)}
            </span>
          `
        : nothing
    }
    <button type="button" class="pairing-window-extend" @click=${onExtend}>
      ${localize("settings.build_server_pairing_window_extend")}
    </button>
  `;
}
