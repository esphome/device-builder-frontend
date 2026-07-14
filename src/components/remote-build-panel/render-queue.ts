import { html, type TemplateResult } from "lit";
import type { ESPHomeRemoteBuildPanel } from "../remote-build-panel.js";
import { renderEmpty, renderGroups } from "../shared/firmware-jobs-list.js";

/** Local build queue — the jobs paired senders feed this receiver. */
export function renderQueueCard(host: ESPHomeRemoteBuildPanel): TemplateResult {
  const { sorted, active, terminal } = host._buckets();
  return html`
    <div class="card">
      <div class="card-heading">
        <span>${host._localize("remote_build_dashboard.queue_heading")}</span>
        ${
          active.length > 0
            ? html`
                <span class="heading-count">
                  ${host._localize("remote_build_dashboard.queue_active_count", {
                    count: active.length,
                  })}
                </span>
              `
            : ""
        }
      </div>
      ${
        sorted.length > 0
          ? renderGroups(host, active, terminal)
          : renderEmpty(host._localize)
      }
    </div>
  `;
}
