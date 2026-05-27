import { html, nothing, type TemplateResult } from "lit";
import { DeviceState, JobStatus, JobType } from "../../api/types.js";
import { getCompactEncryptionVisual } from "../../util/encryption-state.js";
import { renderLabelChips, resolveLabelIds } from "../../util/label-chip-template.js";
import type { ESPHomeDeviceCard } from "../device-card.js";

const RECENT_JOB_ICON: Record<JobStatus, string | null> = {
  [JobStatus.QUEUED]: null,
  [JobStatus.RUNNING]: null,
  [JobStatus.COMPLETED]: "check-circle",
  [JobStatus.FAILED]: "close-circle",
  [JobStatus.CANCELLED]: "cancel",
};

const RECENT_JOB_VARIANT: Record<JobStatus, string> = {
  [JobStatus.QUEUED]: "",
  [JobStatus.RUNNING]: "",
  [JobStatus.COMPLETED]: "completed",
  [JobStatus.FAILED]: "failed",
  [JobStatus.CANCELLED]: "cancelled",
};

const RECENT_JOB_LABEL: Record<JobStatus, string> = {
  [JobStatus.QUEUED]: "",
  [JobStatus.RUNNING]: "",
  [JobStatus.COMPLETED]: "firmware_jobs.status_completed",
  [JobStatus.FAILED]: "firmware_jobs.status_failed",
  [JobStatus.CANCELLED]: "firmware_jobs.status_cancelled",
};

// Caps at 4 visible chips with a "+N" overflow chip — heavily-tagged
// devices don't blow out the card height; full set lives in the drawer.
export function renderLabels(card: ESPHomeDeviceCard): TemplateResult | typeof nothing {
  const labels = resolveLabelIds(card.labelIds, card._labelCatalog);
  if (labels.length === 0) return nothing;
  return html`<div class="device-card-labels">
    ${renderLabelChips(labels, { max: 4 })}
  </div>`;
}

// Compact-view variant: same gate the dashboard table uses, hiding the
// green lock when mDNS has confirmed encryption (steady state on a healthy
// fleet) while keeping every other state including "waiting / unknown"
// visible. (issue #141)
export function renderEncryptionIcon(
  card: ESPHomeDeviceCard
): TemplateResult | typeof nothing {
  const visual = getCompactEncryptionVisual({
    api_enabled: card.apiEnabled,
    api_encrypted: card.apiEncrypted,
    api_encryption_active: card.apiEncryptionActive,
    has_pending_changes: card.hasPendingChanges,
  });
  if (!visual) return nothing;
  return html`<wa-icon
    class="encryption-icon ${visual.cssClass}"
    library="mdi"
    name=${visual.iconName}
    title=${card._localize(visual.tooltipKey)}
  ></wa-icon>`;
}

export function renderStatusBadge(card: ESPHomeDeviceCard): TemplateResult {
  if (card.busy) {
    const labelKey =
      card.activeJob?.job_type === JobType.RENAME
        ? "dashboard.status_renaming"
        : "dashboard.status_installing";
    return html`<div
      class="device-status busy"
      @click=${(e: Event) => {
        e.stopPropagation();
        card._emit("show-progress");
      }}
    >
      <wa-spinner></wa-spinner>
      ${card._localize(labelKey)}
    </div>`;
  }
  if (card.recentJob) {
    const status = card.recentJob.status;
    const icon = RECENT_JOB_ICON[status];
    if (icon) {
      return html`<div
        class="device-status ${RECENT_JOB_VARIANT[status]}"
        title=${card._localize(RECENT_JOB_LABEL[status])}
      >
        <wa-icon library="mdi" name=${icon}></wa-icon>
        ${card._localize(RECENT_JOB_LABEL[status])}
      </div>`;
    }
  }
  // Transport-agnostic icons — wifi/wifi-off implied wireless; plenty of
  // devices on the network are on ethernet. check/off/help-network reads
  // as "online" / "offline" / "unknown" without baking in a link guess.
  const stateIcon =
    card.state === DeviceState.ONLINE
      ? "check-network-outline"
      : card.state === DeviceState.OFFLINE
        ? "network-off-outline"
        : "help-network-outline";
  return html`<div class="device-status ${card.state}">
    <wa-icon library="mdi" name=${stateIcon}></wa-icon>
    ${card.state === DeviceState.ONLINE
      ? card._localize("dashboard.online")
      : card.state === DeviceState.OFFLINE
        ? card._localize("dashboard.offline")
        : card._localize("dashboard.unknown")}
  </div>`;
}
