import { html, nothing, type TemplateResult } from "lit";
import type { PairingWindowState } from "../../api/types/remote-build.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { activeLocale } from "../../common/localize.js";
import { formatDuration, formatMinSec } from "../../util/relative-time.js";

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
                {
                  duration: formatDuration(remaining, {
                    variant: "counter",
                    language: activeLocale(),
                  }),
                }
              )}
            >
              ${formatMinSec(remaining)}
            </span>
          `
        : nothing
    }
    <button type="button" class="pairing-window-extend" @click=${onExtend}>
      ${localize("settings.build_server_pairing_window_extend")}
    </button>
  `;
}
