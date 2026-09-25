import { html, type TemplateResult } from "lit";

import type { ESPHomeLogsDialog } from "../logs-dialog.js";
import { hasSerialPort, isOtaNetwork, isStreaming } from "../logs-session.js";
import {
  renderTermButton,
  renderTermToggle,
} from "../process-terminal/toolbar-button.js";
import { resetOffered } from "./session.js";

/** The terminal's right-hand toolbar: reset or states toggle, expand,
 *  download, clear, and stop / start. */
export function renderLogsToolbar(host: ESPHomeLogsDialog): TemplateResult {
  const s = host._session;
  const streaming = isStreaming(s);
  const toggleLabel = host._localize(
    host._showStates ? "dashboard.logs_hide_states" : "dashboard.logs_show_states"
  );
  const expandLabel = host._localize(
    host._expanded ? "dashboard.logs_collapse" : "dashboard.logs_expand"
  );
  return html`
    <div class="toolbar-slot" slot="toolbar-right">
      ${
        resetOffered(host)
          ? // Web Serial only; disabled until a port is attached.
            renderTermButton({
              icon: "restart",
              label: host._localize("dashboard.logs_reset_device"),
              disabled: !hasSerialPort(s),
              onClick: () => void host._onResetDevice(),
            })
          : isOtaNetwork(s)
            ? // States arrive only over the network/API connection, so the
              // toggle is hidden for a server serial source (#539).
              renderTermToggle({
                active: host._showStates,
                onClick: () => void host._toggleShowStates(),
                icon: "pulse",
                label: host._localize("dashboard.logs_states"),
                title: toggleLabel,
              })
            : ""
      }
      <!-- Kept inline: the expand-btn class drives the mobile hide rule. -->
      <button
        type="button"
        class="term-btn term-btn--ghost expand-btn"
        @click=${host._toggleExpanded}
        title=${expandLabel}
        aria-label=${expandLabel}
      >
        <wa-icon
          library="mdi"
          name=${host._expanded ? "arrow-collapse" : "arrow-expand"}
        ></wa-icon>
      </button>
      ${renderTermButton({
        icon: "download",
        title: host._localize("dashboard.logs_download"),
        onClick: host._downloadLogs,
      })}
      ${renderTermButton({
        icon: "delete-sweep",
        label: host._localize("dashboard.logs_clear"),
        onClick: host._clearLogs,
      })}
      ${
        streaming
          ? renderTermButton({
              icon: "stop",
              label: host._localize("dashboard.logs_stop"),
              variant: "stop",
              onClick: host._onStop,
            })
          : renderTermButton({
              icon: "play",
              label: host._localize("dashboard.logs_start"),
              variant: "start",
              onClick: host._onStart,
            })
      }
    </div>
  `;
}
