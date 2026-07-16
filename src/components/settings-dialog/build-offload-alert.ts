import { html, type TemplateResult } from "lit";

import type { OffloaderAlertSnapshotEntry } from "../../api/types/remote-build-events.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { trimTrailingDot } from "../../util/hostname.js";

interface AlertContext {
  localize: LocalizeFunc;
  /**
   * Live display name for the row (handshake friendly name / custom
   * label); the alert's own receiver_label snapshot is the fallback
   * when the pairing is already gone.
   */
  displayLabel?: string;
  onRepair: (alert: OffloaderAlertSnapshotEntry) => void;
  onUnpair: (alert: OffloaderAlertSnapshotEntry) => void;
}

export function renderOffloaderAlert(
  alert: OffloaderAlertSnapshotEntry,
  { localize, displayLabel, onRepair, onUnpair }: AlertContext
): TemplateResult {
  const target = `${trimTrailingDot(alert.receiver_hostname)}:${alert.receiver_port}`;
  const label = displayLabel || alert.receiver_label;
  if (alert.kind === "pin_mismatch") {
    return html`
      <div class="offloader-alert offloader-alert-pin-mismatch" role="alert">
        <div class="offloader-alert-body">
          <div class="offloader-alert-title">
            ${localize("settings.offloader_alert_pin_mismatch_title", {
              label,
            })}
          </div>
          <div class="offloader-alert-desc">
            ${localize("settings.offloader_alert_pin_mismatch_desc", {
              label,
              target,
            })}
          </div>
        </div>
        <div class="offloader-alert-actions">
          <button
            type="button"
            class="btn-pair-build-server"
            aria-label=${localize("settings.offloader_alert_repair_aria", {
              label,
            })}
            @click=${() => onRepair(alert)}
          >
            ${localize("settings.offloader_alert_repair_action")}
          </button>
          <button
            type="button"
            class="offloader-alert-unpair"
            aria-label=${localize("settings.offloader_alert_unpair_aria", {
              label,
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
            label,
          })}
        </div>
        <div class="offloader-alert-desc">
          ${localize("settings.offloader_alert_peer_revoked_desc", {
            label,
            target,
          })}
        </div>
      </div>
      <div class="offloader-alert-actions">
        <button
          type="button"
          class="offloader-alert-unpair"
          aria-label=${localize("settings.offloader_alert_unpair_aria", {
            label,
          })}
          @click=${() => onUnpair(alert)}
        >
          ${localize("settings.unpair_action")}
        </button>
      </div>
    </div>
  `;
}
