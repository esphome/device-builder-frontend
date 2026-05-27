import { html, type TemplateResult } from "lit";

import type { OffloaderAlertSnapshotEntry } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";

interface AlertContext {
  localize: LocalizeFunc;
  onRepair: (alert: OffloaderAlertSnapshotEntry) => void;
  onUnpair: (alert: OffloaderAlertSnapshotEntry) => void;
}

export function renderOffloaderAlert(
  alert: OffloaderAlertSnapshotEntry,
  { localize, onRepair, onUnpair }: AlertContext
): TemplateResult {
  const target = `${alert.receiver_hostname}:${alert.receiver_port}`;
  if (alert.kind === "pin_mismatch") {
    return html`
      <div class="offloader-alert offloader-alert-pin-mismatch" role="alert">
        <div class="offloader-alert-body">
          <div class="offloader-alert-title">
            ${localize("settings.offloader_alert_pin_mismatch_title", {
              label: alert.receiver_label,
            })}
          </div>
          <div class="offloader-alert-desc">
            ${localize("settings.offloader_alert_pin_mismatch_desc", {
              label: alert.receiver_label,
              target,
            })}
          </div>
        </div>
        <div class="offloader-alert-actions">
          <button
            type="button"
            class="btn-pair-build-server"
            aria-label=${localize("settings.offloader_alert_repair_aria", {
              label: alert.receiver_label,
            })}
            @click=${() => onRepair(alert)}
          >
            ${localize("settings.offloader_alert_repair_action")}
          </button>
          <button
            type="button"
            class="btn-unpair"
            aria-label=${localize("settings.offloader_alert_unpair_aria", {
              label: alert.receiver_label,
            })}
            @click=${() => onUnpair(alert)}
          >
            ${localize("settings.unpair_action")}
          </button>
        </div>
      </div>
    `;
  }
  return html`
    <div class="offloader-alert offloader-alert-peer-revoked" role="alert">
      <div class="offloader-alert-body">
        <div class="offloader-alert-title">
          ${localize("settings.offloader_alert_peer_revoked_title", {
            label: alert.receiver_label,
          })}
        </div>
        <div class="offloader-alert-desc">
          ${localize("settings.offloader_alert_peer_revoked_desc", {
            label: alert.receiver_label,
            target,
          })}
        </div>
      </div>
      <div class="offloader-alert-actions">
        <button
          type="button"
          class="btn-unpair"
          aria-label=${localize("settings.offloader_alert_unpair_aria", {
            label: alert.receiver_label,
          })}
          @click=${() => onUnpair(alert)}
        >
          ${localize("settings.unpair_action")}
        </button>
      </div>
    </div>
  `;
}
