import { html, nothing, type TemplateResult } from "lit";
import {
  JobSource,
  JobStatus,
  type FirmwareJob,
} from "../../api/types.js";
import { firmwareJobDisplayName } from "../../util/firmware-job-display.js";
import { isTerminalJobStatus } from "../../util/firmware-job-status.js";
import type { ESPHomeCommandDialog } from "../command-dialog.js";

// "Building on <receiver>" sub-line for in-flight REMOTE jobs. Falls back to
// the locally-primed snapshot for the gap between followJob and the first
// jobs-context update.
export function renderRemoteBuilderSubLine(
  host: ESPHomeCommandDialog,
): TemplateResult | typeof nothing {
  if (!host._jobId) return nothing;
  const liveJob = host._jobs.get(host._jobId);
  if (liveJob && isTerminalJobStatus(liveJob.status)) return nothing;
  // Live entry wins when present — canonical source the rest of the dialog
  // reads from. source_label is a snapshot at job-creation time per the
  // wire contract, so the two agree once _jobs catches up.
  const source = liveJob?.source ?? host._primedSource?.source;
  const label = liveJob?.source_label ?? host._primedSource?.source_label;
  if (source !== JobSource.REMOTE || !label) return nothing;
  // Only allow override for in-flight install — switching mid-upload or
  // mid-compile is a power-user shape without a UI today.
  const canOverride = host._commandType === "install";
  return html`
    <div class="remote-builder-sub-line" role="status">
      <wa-icon library="mdi" name="server-network"></wa-icon>
      <span
        >${host._localize("command.remote_builder_sub_line", {
          receiver: label,
        })}</span
      >
      ${canOverride
        ? html`
            <span class="spacer"></span>
            <button
              class="force-local-link"
              ?disabled=${host._switchingToLocal}
              @click=${host._onForceLocalClick}
            >
              ${host._switchingToLocal
                ? host._localize("command.force_local_switching")
                : host._localize("command.force_local_action")}
            </button>
          `
        : nothing}
    </div>
  `;
}

function runningJob(jobs: Map<string, FirmwareJob>): FirmwareJob | null {
  for (const job of jobs.values()) {
    if (job.status === JobStatus.RUNNING) return job;
  }
  return null;
}

export function renderQueuedOverlay(
  host: ESPHomeCommandDialog,
): TemplateResult | typeof nothing {
  if (!host._isQueued && !host._isRemoteQueued) return nothing;
  // Only surface the "waiting for <device>" hint for same-offloader queues
  // where we know the predecessor; cross-offloader queues get a generic
  // message that doesn't reveal what another user is building.
  const running = host._isQueued ? runningJob(host._jobs) : null;
  const message = running
    ? host._localize("command.queued_waiting_for", {
        name: firmwareJobDisplayName(running, host._devices, host._localize),
      })
    : host._isRemoteQueued
      ? host._localize("command.queued_waiting_for_build_server")
      : host._localize("command.queued_message");
  return html`
    <div class="queued-overlay" role="status" aria-live="polite">
      <wa-icon library="mdi" name="timer-sand"></wa-icon>
      <div class="queued-title">${host._localize("command.queued_title")}</div>
      <div class="queued-message">${message}</div>
      <button class="term-btn term-btn--start" @click=${host._openFirmwareJobs}>
        <wa-icon library="mdi" name="playlist-check"></wa-icon>
        ${host._localize("command.queued_view_all")}
      </button>
    </div>
  `;
}

export function renderBanner(host: ESPHomeCommandDialog): TemplateResult | typeof nothing {
  if (host._state !== "success" && host._state !== "error") return nothing;
  const isSuccess = host._state === "success";
  const icon = isSuccess ? "check-circle" : "alert-circle";
  const modifier = isSuccess ? "success" : "error";
  return html`
    <div class="status-banner status-banner--${modifier}">
      <wa-icon library="mdi" name=${icon}></wa-icon>
      <span>${host._statusMessage}</span>
    </div>
  `;
}

// YAML validation failure → "open in editor". Build failure → clean → reset
// staircase. _userStopped is shared — a user-cancel isn't a build problem.
export function renderResetSuggestion(
  host: ESPHomeCommandDialog,
): TemplateResult | typeof nothing {
  if (host._state !== "error") return nothing;
  if (host._userStopped) return nothing;
  if (host._commandType === "validate" || host._failedDuringValidate) {
    return renderValidationFailureSuggestion(host);
  }
  if (host._commandType !== "install" && host._commandType !== "compile") {
    return nothing;
  }
  return renderBuildFailureSuggestion(host);
}

function renderValidationFailureSuggestion(host: ESPHomeCommandDialog): TemplateResult {
  const text = host._localize("command.validation_failed_suggestion");
  const [before, after = ""] = text.split("{editor_action}");
  return html`
    <div class="reset-suggestion" role="status">
      ${before}<button class="reset-suggestion-link" @click=${host._tryOpenInEditor}>
        ${host._localize("command.try_open_editor_button")}</button
      >${after}
    </div>
  `;
}

function renderBuildFailureSuggestion(host: ESPHomeCommandDialog): TemplateResult {
  const text = host._localize("command.try_reset_suggestion");
  const [before, rest = ""] = text.split("{clean_action}");
  const [middle, after = ""] = rest.split("{reset_action}");
  return html`
    <div class="reset-suggestion" role="status">
      ${before}<button class="reset-suggestion-link" @click=${host._tryCleanBuild}>
        ${host._localize("command.try_clean_button")}</button
      >${middle}<button class="reset-suggestion-link" @click=${host._tryResetBuildEnv}>
        ${host._localize("command.try_reset_button")}</button
      >${after}
    </div>
  `;
}

interface ToolbarToggleOpts {
  active: boolean;
  onClick: () => void;
  iconActive: string;
  iconInactive: string;
  labelKeyActive: string;
  labelKeyInactive: string;
  tooltipKeyActive: string;
  tooltipKeyInactive: string;
}

function renderToolbarToggle(
  host: ESPHomeCommandDialog,
  opts: ToolbarToggleOpts,
): TemplateResult {
  const labelKey = opts.active ? opts.labelKeyActive : opts.labelKeyInactive;
  const tooltipKey = opts.active ? opts.tooltipKeyActive : opts.tooltipKeyInactive;
  const icon = opts.active ? opts.iconActive : opts.iconInactive;
  return html`<button
    class="term-btn term-btn--ghost ${opts.active ? "is-active" : ""}"
    @click=${opts.onClick}
    title=${host._localize(tooltipKey)}
    aria-pressed=${opts.active ? "true" : "false"}
  >
    <wa-icon library="mdi" name=${icon}></wa-icon>
    ${host._localize(labelKey)}
  </button>`;
}

// --show-secrets is an `esphome config` flag — hide the toggle on every other
// command type to keep the toolbar from accumulating inert buttons.
function renderShowSecretsToggle(
  host: ESPHomeCommandDialog,
): TemplateResult | typeof nothing {
  if (host._commandType !== "validate") return nothing;
  return renderToolbarToggle(host, {
    active: host._showSecrets,
    onClick: host._toggleShowSecrets,
    iconActive: "key",
    iconInactive: "key-outline",
    labelKeyActive: "command.hide_secrets",
    labelKeyInactive: "command.show_secrets",
    tooltipKeyActive: "command.hide_secrets_tooltip",
    tooltipKeyInactive: "command.show_secrets_tooltip",
  });
}

// Disappears once the install settles — the user already declared their
// preference, no point in showing a no-op control after.
function renderShowLogsAfterInstallToggle(
  host: ESPHomeCommandDialog,
): TemplateResult | typeof nothing {
  if (host._commandType !== "install") return nothing;
  if (host._state === "success" || host._state === "error") return nothing;
  return renderToolbarToggle(host, {
    active: host._showLogsAfterInstall,
    onClick: host._toggleShowLogsAfterInstall,
    iconActive: "console",
    iconInactive: "console",
    // Single label both ways — checkbox-style toggle, is-active carries on/off.
    labelKeyActive: "command.show_logs_after_install",
    labelKeyInactive: "command.show_logs_after_install",
    tooltipKeyActive: "command.show_logs_after_install_tooltip",
    tooltipKeyInactive: "command.show_logs_after_install_tooltip",
  });
}

export function renderToolbar(host: ESPHomeCommandDialog): TemplateResult {
  return html`
    <div class="terminal-toolbar">
      ${host._state === "running" ? html`<span class="streaming-dot"></span>` : nothing}
      <span class="spacer"></span>
      ${renderShowSecretsToggle(host)} ${renderShowLogsAfterInstallToggle(host)}
      ${host._lines.length > 0
        ? html`<button
            class="term-btn term-btn--ghost"
            @click=${host._downloadOutput}
            title=${host._localize("command.download")}
            aria-label=${host._localize("command.download")}
          >
            <wa-icon library="mdi" name="download"></wa-icon>
          </button>`
        : nothing}
      ${renderActions(host)}
    </div>
  `;
}

// Retry only makes sense for command types _start knows how to re-run.
// RENAME jobs come in via followJob — the user originally launched from the
// rename dialog; surfacing Retry would no-op.
function renderActions(host: ESPHomeCommandDialog): TemplateResult | typeof nothing {
  switch (host._state) {
    case "running":
      return html`<button class="term-btn term-btn--stop" @click=${host._stop}>
        <wa-icon library="mdi" name="stop"></wa-icon>
        ${host._localize("command.stop")}
      </button>`;
    case "error":
      return host._commandType === "rename"
        ? html`<button class="term-btn term-btn--ghost" @click=${host.close}>
            ${host._localize("command.close")}
          </button>`
        : html` <button class="term-btn term-btn--start" @click=${host._start}>
              <wa-icon library="mdi" name="refresh"></wa-icon>
              ${host._localize("command.retry")}
            </button>
            <button class="term-btn term-btn--ghost" @click=${host.close}>
              ${host._localize("command.close")}
            </button>`;
    case "success":
      // Show-logs is a ghost (not term-btn--start) so it doesn't look like
      // the toolbar toggle "stayed on".
      return host._commandType === "install"
        ? html`<button class="term-btn term-btn--ghost" @click=${host._flipToLogs}>
              <wa-icon library="mdi" name="console"></wa-icon>
              ${host._localize("command.show_logs")}
            </button>
            <button class="term-btn term-btn--ghost" @click=${host.close}>
              ${host._localize("command.close")}
            </button>`
        : html`<button class="term-btn term-btn--ghost" @click=${host.close}>
            ${host._localize("command.close")}
          </button>`;
    default:
      return nothing;
  }
}
