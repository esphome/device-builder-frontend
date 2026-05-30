/**
 * The "Show advanced settings" switch row that gates a
 * config-entry-form's advanced fields. Shared by every form host —
 * device sections, automation triggers, scripts, and actions — so
 * the markup and the ``device.show_advanced`` label stay in one place.
 */
import { html } from "lit";

import type { LocalizeFunc } from "../../common/localize.js";

import "@home-assistant/webawesome/dist/components/switch/switch.js";

export function renderAdvancedToggle(
  show: boolean,
  localize: LocalizeFunc,
  onChange: (show: boolean) => void
) {
  return html`<div class="advanced-toggle-row">
    <wa-switch
      .checked=${show}
      @change=${(e: Event) =>
        onChange((e.target as HTMLInputElement & { checked: boolean }).checked)}
    >
      ${localize("device.show_advanced")}
    </wa-switch>
  </div>`;
}
