import { html, nothing, type TemplateResult } from "lit";
import { DeviceState } from "../../api/types/devices.js";
import { JobStatus, JobType } from "../../api/types/firmware-jobs.js";
import { isStatusUntracked } from "../../util/device-status.js";
import { getCompactEncryptionVisual } from "../../util/encryption-state.js";
import { fireEvent } from "../../util/fire-event.js";
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

// Compact view: no lock for encrypted devices, only the attention
// states (plaintext / pending / mismatch) get an icon.
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
  // Plaintext is the only actionable state: render the warning as a button
  // that deep-links to the api section's Enable-encryption affordance, named
  // with the warning plus the action so neither is lost. Passive while
  // selecting — in select mode the whole card is one toggle target.
  if (visual.actionable && !card.selectMode) {
    const label = card._localize(visual.actionTooltipKey);
    return html`<button
        id="ind-encryption"
        type="button"
        class="encryption-icon ${visual.cssClass}"
        aria-label=${label}
        @click=${(e: Event) => {
          e.stopPropagation();
          fireEvent(card, "open-encryption-settings");
        }}
      >
        <wa-icon library="mdi" name=${visual.iconName}></wa-icon>
      </button>
      <wa-tooltip for="ind-encryption">${label}</wa-tooltip>`;
  }
  const tooltip = card._localize(visual.tooltipKey);
  return html`<wa-icon
      id="ind-encryption"
      class="encryption-icon ${visual.cssClass}"
      library="mdi"
      name=${visual.iconName}
      tabindex="0"
      role="img"
      aria-label=${tooltip}
    ></wa-icon>
    <wa-tooltip for="ind-encryption">${tooltip}</wa-tooltip>`;
}

export function renderStatusBadge(card: ESPHomeDeviceCard): TemplateResult {
  if (card.busy) {
    const labelKey =
      card.activeJob?.job_type === JobType.RENAME
        ? "dashboard.status_renaming"
        : card.activeJob?.job_type === JobType.COMPILE
          ? "dashboard.status_compiling"
          : "dashboard.status_installing";
    return html`<div
      class="device-status busy"
      @click=${(e: Event) => {
        e.stopPropagation();
        fireEvent(card, "show-progress");
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
      return html`<div class="device-status ${RECENT_JOB_VARIANT[status]}">
        <wa-icon library="mdi" name=${icon}></wa-icon>
        ${card._localize(RECENT_JOB_LABEL[status])}
      </div>`;
    }
  }
  if (isStatusUntracked(card.state, card.nameAddMacSuffix)) {
    const label = card._localize("dashboard.status_untracked");
    const tooltip = card._localize("dashboard.status_untracked_tooltip");
    return html`<div
        id="status-untracked"
        class="device-status ${DeviceState.UNKNOWN}"
        role="img"
        tabindex="0"
        aria-label="${label}. ${tooltip}"
      >
        <wa-icon library="mdi" name="help-network-outline"></wa-icon>
        ${label}
      </div>
      <wa-tooltip for="status-untracked">${tooltip}</wa-tooltip>`;
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
    ${
      card.state === DeviceState.ONLINE
        ? card._localize("dashboard.online")
        : card.state === DeviceState.OFFLINE
          ? card._localize("dashboard.offline")
          : card._localize("dashboard.unknown")
    }
  </div>`;
}
