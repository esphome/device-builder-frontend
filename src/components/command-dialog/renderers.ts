import { html, nothing, type TemplateResult } from "lit";
import { type FirmwareJob, JobSource, JobStatus } from "../../api/types/firmware-jobs.js";
import { firmwareJobDisplayName } from "../../util/firmware-job-display.js";
import { isTerminalJobStatus } from "../../util/firmware-job-status.js";
import type { ESPHomeCommandDialog } from "../command-dialog.js";
import {
  renderBuildFailureSuggestion,
  renderValidationFailureSuggestion,
} from "../process-terminal/reset-suggestion.js";
import {
  renderTermButton,
  renderTermToggle,
} from "../process-terminal/toolbar-button.js";

// "Building on <receiver>" sub-line for in-flight REMOTE jobs. Falls back to
// the locally-primed snapshot for the gap between followJob and the first
// jobs-context update.
export function renderRemoteBuilderSubLine(
  host: ESPHomeCommandDialog
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
  // source_esphome_version is also a job-creation-time snapshot; empty when
  // the pairing hadn't completed a peer-link session yet. Render "<label>
  // (<version>)" so the operator can spot version skew vs the offloader.
  const version =
    liveJob?.source_esphome_version ?? host._primedSource?.source_esphome_version ?? "";
  const display = version ? `${label} (${version})` : label;
  // Only allow override for in-flight install — switching mid-upload or
  // mid-compile is a power-user shape without a UI today.
  const canOverride = host._commandType === "install";
  return html`
    <div class="remote-builder-sub-line" role="status" slot="sub-line">
      <wa-icon library="mdi" name="server-network"></wa-icon>
      <span
        >${host._localize("command.remote_builder_sub_line", {
          receiver: display,
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
  host: ESPHomeCommandDialog
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
    <div class="queued-overlay" role="status" aria-live="polite" slot="overlay">
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

// YAML validation failure → "open in editor". Build failure → clean → reset
// staircase. _userStopped is shared — a user-cancel isn't a build problem.
// The success / error status banner itself is rendered by
// <esphome-process-terminal> from the dialog's state + status message.
export function renderResetSuggestion(
  host: ESPHomeCommandDialog
): TemplateResult | typeof nothing {
  if (host._state !== "error") return nothing;
  if (host._userStopped) return nothing;
  if (host._commandType === "validate" || host._failedDuringValidate) {
    return renderValidationFailureSuggestion(host);
  }
  if (host._commandType !== "install" && host._commandType !== "compile") {
    return nothing;
  }
  return renderBuildFailureSuggestion(host, remotePeerLabel(host));
}

// Resolve the receiver label for a REMOTE-sourced job. Returns null for
// LOCAL builds (or when the live + primed snapshots both lack a label) so
// the shared renderer falls back to the local reset-build-env link.
function remotePeerLabel(host: ESPHomeCommandDialog): string | null {
  const live = host._jobId ? host._jobs.get(host._jobId) : undefined;
  const primed = host._primedSource;
  if ((live?.source ?? primed?.source) !== JobSource.REMOTE) return null;
  return live?.source_label || primed?.source_label || null;
}

// --show-secrets is an `esphome config` flag — hide the toggle on every other
// command type to keep the toolbar from accumulating inert buttons.
function renderShowSecretsToggle(
  host: ESPHomeCommandDialog
): TemplateResult | typeof nothing {
  if (host._commandType !== "validate") return nothing;
  return renderTermToggle({
    active: host._showSecrets,
    onClick: host._toggleShowSecrets,
    iconActive: "key",
    iconInactive: "key-outline",
    labelActive: host._localize("command.hide_secrets"),
    labelInactive: host._localize("command.show_secrets"),
    title: host._localize(
      host._showSecrets ? "command.hide_secrets_tooltip" : "command.show_secrets_tooltip"
    ),
  });
}

// Disappears once the install settles — the user already declared their
// preference, no point in showing a no-op control after.
function renderShowLogsAfterInstallToggle(
  host: ESPHomeCommandDialog
): TemplateResult | typeof nothing {
  if (host._commandType !== "install") return nothing;
  if (host._state === "success" || host._state === "error") return nothing;
  // Single label both ways — checkbox-style toggle, is-active carries on/off.
  return renderTermToggle({
    active: host._showLogsAfterInstall,
    onClick: host._toggleShowLogsAfterInstall,
    icon: "text-box-outline",
    label: host._localize("command.show_logs_after_install"),
    title: host._localize("command.show_logs_after_install_tooltip"),
  });
}

// Right-aligned toolbar controls slotted into <esphome-process-terminal>'s
// toolbar; the component renders the toolbar container, the streaming dot, and
// the spacer.
export function renderToolbar(host: ESPHomeCommandDialog): TemplateResult {
  return html`
    ${renderShowSecretsToggle(host)} ${renderShowLogsAfterInstallToggle(host)}
    ${host._lines.length > 0
      ? renderTermButton({
          icon: "download",
          title: host._localize("command.download"),
          onClick: host._downloadOutput,
        })
      : nothing}
    ${renderActions(host)}
  `;
}

// Retry only makes sense for command types _start knows how to re-run.
// RENAME jobs come in via followJob — the user originally launched from the
// rename dialog; surfacing Retry would no-op.
function renderActions(host: ESPHomeCommandDialog): TemplateResult | typeof nothing {
  const close = renderTermButton({
    label: host._localize("command.close"),
    onClick: host.close,
  });
  switch (host._state) {
    case "running":
      return renderTermButton({
        icon: "stop",
        label: host._localize("command.stop"),
        variant: "stop",
        onClick: host._stop,
      });
    case "error":
      return host._commandType === "rename"
        ? close
        : html`${renderTermButton({
            icon: "refresh",
            label: host._localize("command.retry"),
            variant: "start",
            onClick: host._start,
          })}
          ${close}`;
    case "success":
      // Show-logs is a ghost (not term-btn--start) so it doesn't look like
      // the toolbar toggle "stayed on".
      return host._commandType === "install"
        ? html`${renderTermButton({
            icon: "text-box-outline",
            label: host._localize("command.show_logs"),
            onClick: host._flipToLogs,
          })}
          ${close}`
        : close;
    default:
      return nothing;
  }
}
