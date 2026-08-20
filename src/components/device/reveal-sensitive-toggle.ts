import { mdiEye, mdiEyeOff } from "@mdi/js";
import { html, type TemplateResult } from "lit";
import type { LocalizeFunc } from "../../common/localize.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/tooltip/tooltip.js";

registerMdiIcons({
  eye: mdiEye,
  "eye-off": mdiEyeOff,
});

/**
 * The eye toggle every masked-YAML surface shares (editor toolbar, diff
 * previews). Hosts style it via `ghost-icon-btn` from `espHomeStyles`.
 */
export function renderRevealSensitiveToggle(
  localize: LocalizeFunc,
  revealed: boolean,
  onToggle: () => void,
  extraClass = ""
): TemplateResult {
  const label = localize(
    revealed ? "device.yaml_mask_sensitive" : "device.yaml_reveal_sensitive"
  );
  return html`<button
      id="btn-reveal-sensitive"
      type="button"
      class="ghost-icon-btn ${extraClass}"
      aria-pressed=${revealed}
      aria-label=${label}
      @click=${onToggle}
    >
      <wa-icon library="mdi" name=${revealed ? "eye-off" : "eye"}></wa-icon>
    </button>
    <wa-tooltip for="btn-reveal-sensitive">${label}</wa-tooltip>`;
}
