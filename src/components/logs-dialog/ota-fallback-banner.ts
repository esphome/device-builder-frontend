import { html, type TemplateResult } from "lit";
import { splitTemplate } from "../../util/template-split.js";
import type { ESPHomeLogsDialog } from "../logs-dialog.js";
import { switchToOtaLogs } from "./session.js";

/**
 * Muted escape hatch for a Web Serial session that shows nothing: an inline
 * offer to stream network logs instead. Slotted into the terminal's
 * suggestion slot; the reset-suggestion idiom (deliberately quieter than
 * the crash callout).
 */
export function renderOtaFallbackBanner(host: ESPHomeLogsDialog): TemplateResult {
  const [before, after] = splitTemplate(
    host._localize("dashboard.logs_no_serial_output"),
    "{network_action}"
  );
  return html`
    <div class="reset-suggestion" role="status" slot="suggestion">
      ${before}<button
        class="reset-suggestion-link"
        @click=${() => switchToOtaLogs(host)}
      >
        ${host._localize("dashboard.logs_switch_to_network")}</button
      >${after}
    </div>
  `;
}
