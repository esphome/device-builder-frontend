import { html, nothing, type TemplateResult } from "lit";

import { renderTermButton } from "../../components/process-terminal/toolbar-button.js";
import type { ESPHomeWebLogsDialog } from "./esphome-web-logs-dialog.js";

/** The terminal's right-hand toolbar: reset, download, clear, stop / start. */
export function renderWebLogsToolbar(host: ESPHomeWebLogsDialog): TemplateResult {
  return html`
    <div class="toolbar-slot" slot="toolbar-right">
      ${
        !host.canReset
          ? nothing
          : renderTermButton({
              icon: "restart",
              // Reuse the builder's logs-terminal labels (same context) so
              // translators don't re-translate these generic strings.
              label: host._localize("dashboard.logs_reset_device"),
              disabled: !host.resetReady,
              onClick: () => void host._resetDevice(),
            })
      }
      ${renderTermButton({
        icon: "download",
        title: host._localize("web.logs.download"),
        onClick: () => host._download(),
      })}
      ${renderTermButton({
        icon: "delete-sweep",
        label: host._localize("dashboard.logs_clear"),
        onClick: () => host._clear(),
      })}
      ${
        host._streaming
          ? renderTermButton({
              icon: "stop",
              label: host._localize("dashboard.logs_stop"),
              variant: "stop",
              onClick: () => host._onStop(),
            })
          : host._paused
            ? renderTermButton({
                icon: "play",
                label: host._localize("dashboard.logs_start"),
                variant: "start",
                onClick: () => host._onStart(),
              })
            : nothing
      }
    </div>
  `;
}
