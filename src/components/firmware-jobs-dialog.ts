import { consume } from "@lit/context";
import {
  mdiBroom,
  mdiCancel,
  mdiCheckCircle,
  mdiClockOutline,
  mdiClose,
  mdiCloseCircle,
  mdiCogRefresh,
  mdiDeleteSweep,
  mdiHammerWrench,
  mdiPlaylistRemove,
  mdiRenameOutline,
  mdiUpload,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import { JobStatus, JobType } from "../api/types.js";
import type { ConfiguredDevice, FirmwareJob } from "../api/types.js";
import { activeLocale } from "../common/localize.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  apiContext,
  devicesContext,
  firmwareJobsContext,
  localizeContext,
} from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from "../util/format-job-time.js";
import { firmwareJobDisplayName } from "../util/firmware-job-display.js";
import { registerMdiIcons } from "../util/register-icons.js";
import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "./command-dialog.js";
import type { ESPHomeCommandDialog } from "./command-dialog.js";
import "./confirm-dialog.js";
import type { ESPHomeConfirmDialog } from "./confirm-dialog.js";

registerMdiIcons({
  broom: mdiBroom,
  cancel: mdiCancel,
  "check-circle": mdiCheckCircle,
  "clock-outline": mdiClockOutline,
  close: mdiClose,
  "close-circle": mdiCloseCircle,
  "cog-refresh": mdiCogRefresh,
  "delete-sweep": mdiDeleteSweep,
  "hammer-wrench": mdiHammerWrench,
  "playlist-remove": mdiPlaylistRemove,
  "rename-outline": mdiRenameOutline,
  upload: mdiUpload,
});

const TYPE_ICONS: Record<JobType, string> = {
  [JobType.COMPILE]: "hammer-wrench",
  [JobType.UPLOAD]: "upload",
  [JobType.INSTALL]: "upload",
  [JobType.CLEAN]: "broom",
  [JobType.RESET_BUILD_ENV]: "cog-refresh",
  [JobType.RENAME]: "rename-outline",
};

const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set([
  JobStatus.COMPLETED,
  JobStatus.FAILED,
  JobStatus.CANCELLED,
]);

function isTerminal(job: FirmwareJob): boolean {
  return TERMINAL_STATUSES.has(job.status);
}

@customElement("esphome-firmware-jobs-dialog")
export class ESPHomeFirmwareJobsDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @consume({ context: firmwareJobsContext, subscribe: true })
  @state()
  private _jobs: Map<string, FirmwareJob> = new Map();

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  @query("esphome-command-dialog")
  private _commandDialog!: ESPHomeCommandDialog;

  @query("esphome-confirm-dialog")
  private _confirmDialog!: ESPHomeConfirmDialog;

  // Ticker for live relative-time strings ("started 2m ago"). Only
  // runs while the dialog is open.
  @state()
  private _now: number = Date.now();

  private _tickHandle: ReturnType<typeof setInterval> | null = null;

  open() {
    this._now = Date.now();
    this._dialog.open = true;
    this._startTicker();
  }

  close() {
    this._dialog.open = false;
    this._stopTicker();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopTicker();
  }

  static styles = [
    espHomeStyles,
    css`
      wa-dialog {
        --width: min(620px, 95vw);
      }

      wa-dialog::part(header) {
        background: var(--esphome-primary);
        padding: 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }

      wa-dialog::part(title) {
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      wa-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
        padding: 0;
        min-width: unset;
        min-height: unset;
        color: var(--esphome-on-primary);
        cursor: pointer;
      }

      wa-dialog::part(footer) {
        display: none;
      }

      wa-dialog::part(body) {
        padding: 0;
      }

      .toolbar {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        padding: var(--wa-space-s) var(--wa-space-m);
        border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: var(--wa-color-surface-default);
      }

      .toolbar .spacer {
        flex: 1;
      }

      .tool-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: var(--wa-border-radius-m);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: var(--wa-color-surface-default);
        font-family: inherit;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
        cursor: pointer;
        transition: background 0.1s, border-color 0.1s, color 0.1s;
      }

      .tool-btn:hover {
        background: var(--wa-color-surface-lowered);
        border-color: var(--wa-color-text-quiet);
      }

      .tool-btn wa-icon {
        font-size: 16px;
      }

      .tool-btn--ghost {
        background: transparent;
        border-color: transparent;
        color: var(--wa-color-text-quiet);
      }

      .tool-btn--ghost:hover {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
      }

      .empty {
        padding: var(--wa-space-2xl) var(--wa-space-m);
        text-align: center;
        color: var(--wa-color-text-quiet);
      }

      .empty wa-icon {
        display: block;
        margin: 0 auto var(--wa-space-s);
        font-size: 48px;
        opacity: 0.4;
      }

      .empty-title {
        font-size: var(--wa-font-size-m);
        color: var(--wa-color-text-normal);
        margin-bottom: var(--wa-space-2xs);
      }

      .empty-desc {
        font-size: var(--wa-font-size-s);
      }

      .jobs {
        display: flex;
        flex-direction: column;
        gap: 0;
        padding: var(--wa-space-2xs);
        max-height: 60vh;
        overflow-y: auto;
      }

      .group-label {
        padding: var(--wa-space-s) var(--wa-space-m) var(--wa-space-2xs);
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .job {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: var(--wa-space-s);
        padding: var(--wa-space-s) var(--wa-space-m);
        border-radius: var(--wa-border-radius-m);
        cursor: pointer;
        transition: background 0.1s;
        text-align: left;
        background: transparent;
        border: none;
        font-family: inherit;
        color: inherit;
        width: 100%;
      }

      .job:hover,
      .job:focus-visible {
        background: var(--wa-color-surface-lowered);
        outline: none;
      }

      .job-icon {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        background: color-mix(in srgb, var(--esphome-primary), transparent 90%);
        color: var(--esphome-primary);
      }

      .job-icon--terminal {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-quiet);
      }

      .job-icon wa-icon {
        font-size: 18px;
      }

      .job-content {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .job-name {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .job-meta {
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
      }

      .job-status {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      .job-status wa-spinner {
        font-size: 12px;
        --indicator-color: var(--esphome-primary);
        --track-color: transparent;
      }

      .job-status wa-icon {
        font-size: 13px;
      }

      .job-time {
        white-space: nowrap;
      }

      .job-status--success {
        color: var(--esphome-success);
      }

      .job-status--error {
        color: var(--esphome-error);
      }

      .progress {
        margin-top: 4px;
        width: 100%;
        height: 4px;
        border-radius: 2px;
        background: var(--wa-color-surface-lowered);
        overflow: hidden;
      }

      .progress-fill {
        height: 100%;
        background: var(--esphome-primary);
        transition: width 0.2s;
      }

      .row-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        border-radius: var(--wa-border-radius-m);
        border: none;
        background: transparent;
        color: var(--wa-color-text-quiet);
        cursor: pointer;
        transition: background 0.1s, color 0.1s;
      }

      .row-action:hover {
        background: color-mix(in srgb, var(--esphome-error), transparent 90%);
        color: var(--esphome-error);
      }

      .row-action wa-icon {
        font-size: 18px;
      }

      .row-status-icon {
        width: 30px;
        height: 30px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
      }

      .row-status-icon--success {
        color: var(--esphome-success);
      }

      .row-status-icon--error {
        color: var(--esphome-error);
      }

      .row-status-icon--cancelled {
        color: var(--wa-color-text-quiet);
      }
    `,
  ];

  protected render() {
    const sorted = [...this._jobs.values()].sort(this._compareJobs);
    const active = sorted.filter((j) => !isTerminal(j));
    const terminal = sorted.filter((j) => isTerminal(j));
    const hasJobs = sorted.length > 0;

    return html`
      <wa-dialog
        light-dismiss
        label=${this._localize("firmware_jobs.title")}
        @wa-after-hide=${this._stopTicker}
      >
        <div class="toolbar">
          <button
            class="tool-btn"
            title=${this._localize("firmware_jobs.reset_build_env")}
            @click=${this._onResetClick}
          >
            <wa-icon library="mdi" name="cog-refresh"></wa-icon>
            ${this._localize("firmware_jobs.reset_build_env")}
          </button>
          <span class="spacer"></span>
          ${terminal.length > 0
            ? html`
                <button
                  class="tool-btn tool-btn--ghost"
                  title=${this._localize("firmware_jobs.clear_history")}
                  @click=${this._onClearHistory}
                >
                  <wa-icon library="mdi" name="delete-sweep"></wa-icon>
                  ${this._localize("firmware_jobs.clear_history")}
                </button>
              `
            : nothing}
        </div>
        ${hasJobs
          ? this._renderGroups(active, terminal)
          : this._renderEmpty()}
      </wa-dialog>
      <esphome-command-dialog></esphome-command-dialog>
      <esphome-confirm-dialog
        heading=${this._localize("firmware_jobs.reset_confirm_title")}
        confirm-label=${this._localize("firmware_jobs.reset_confirm_button")}
        message=${this._localize("firmware_jobs.reset_confirm_message")}
        @confirm=${this._onResetConfirmed}
      ></esphome-confirm-dialog>
    `;
  }

  private _renderEmpty() {
    return html`
      <div class="empty">
        <wa-icon library="mdi" name="playlist-remove"></wa-icon>
        <div class="empty-title">${this._localize("firmware_jobs.empty_title")}</div>
        <div class="empty-desc">${this._localize("firmware_jobs.empty_desc")}</div>
      </div>
    `;
  }

  private _renderGroups(active: FirmwareJob[], terminal: FirmwareJob[]) {
    return html`
      <div class="jobs">
        ${active.length > 0
          ? html`
              <div class="group-label">
                ${this._localize("firmware_jobs.group_active")}
              </div>
              ${active.map((j) => this._renderJob(j))}
            `
          : nothing}
        ${terminal.length > 0
          ? html`
              <div class="group-label">
                ${this._localize("firmware_jobs.group_history")}
              </div>
              ${terminal.map((j) => this._renderJob(j))}
            `
          : nothing}
      </div>
    `;
  }

  private _renderJob(job: FirmwareJob) {
    const name = this._jobDisplayName(job);
    const typeIcon = TYPE_ICONS[job.job_type] ?? "hammer-wrench";
    const typeLabel = this._localize(`firmware_jobs.type_${job.job_type}`);
    const showProgress =
      job.status === JobStatus.RUNNING && typeof job.progress === "number";
    const terminal = isTerminal(job);

    return html`
      <button
        class="job"
        @click=${() => this._openJob(job)}
      >
        <div class="job-icon ${terminal ? "job-icon--terminal" : ""}">
          <wa-icon library="mdi" name=${typeIcon}></wa-icon>
        </div>
        <div class="job-content">
          <div class="job-name">${name}</div>
          <div class="job-meta">
            <span>${typeLabel}</span>
            <span>•</span>
            ${this._renderStatus(job)}
            ${this._renderTimestamp(job)}
          </div>
          ${showProgress
            ? html`
                <div class="progress">
                  <div class="progress-fill" style="width:${job.progress}%"></div>
                </div>
              `
            : nothing}
        </div>
        ${this._renderRowAction(job)}
      </button>
    `;
  }

  private _renderRowAction(job: FirmwareJob) {
    if (job.status === JobStatus.COMPLETED) {
      return html`
        <span class="row-status-icon row-status-icon--success" aria-label=${this._localize("firmware_jobs.status_completed")}>
          <wa-icon library="mdi" name="check-circle"></wa-icon>
        </span>
      `;
    }
    if (job.status === JobStatus.FAILED) {
      return html`
        <span class="row-status-icon row-status-icon--error" aria-label=${this._localize("firmware_jobs.status_failed")}>
          <wa-icon library="mdi" name="close-circle"></wa-icon>
        </span>
      `;
    }
    if (job.status === JobStatus.CANCELLED) {
      return html`
        <span class="row-status-icon row-status-icon--cancelled" aria-label=${this._localize("firmware_jobs.status_cancelled")}>
          <wa-icon library="mdi" name="cancel"></wa-icon>
        </span>
      `;
    }
    return html`
      <button
        class="row-action"
        title=${this._localize("firmware_jobs.cancel")}
        aria-label=${this._localize("firmware_jobs.cancel")}
        @click=${(e: Event) => this._onCancelClick(e, job)}
      >
        <wa-icon library="mdi" name="close"></wa-icon>
      </button>
    `;
  }

  private _renderStatus(job: FirmwareJob) {
    if (job.status === JobStatus.RUNNING) {
      return html`
        <span class="job-status">
          <wa-spinner></wa-spinner>
          ${typeof job.progress === "number"
            ? `${job.progress}%`
            : this._localize("firmware_jobs.status_running")}
        </span>
      `;
    }
    if (job.status === JobStatus.QUEUED) {
      return html`
        <span class="job-status">
          <wa-icon library="mdi" name="clock-outline"></wa-icon>
          ${this._localize("firmware_jobs.status_queued")}
        </span>
      `;
    }
    if (job.status === JobStatus.COMPLETED) {
      return html`
        <span class="job-status job-status--success">
          ${this._localize("firmware_jobs.status_completed")}
        </span>
      `;
    }
    if (job.status === JobStatus.FAILED) {
      return html`
        <span class="job-status job-status--error">
          ${this._localize("firmware_jobs.status_failed")}
        </span>
      `;
    }
    if (job.status === JobStatus.CANCELLED) {
      return html`
        <span class="job-status">
          ${this._localize("firmware_jobs.status_cancelled")}
        </span>
      `;
    }
    return nothing;
  }

  /** Active rows show a relative time ("started 2m ago") that ticks
   *  alongside the dialog's `_now` ticker; terminal rows show an
   *  absolute "finished HH:MM" since the moment doesn't change once
   *  it lands. */
  private _renderTimestamp(job: FirmwareJob) {
    const locale = activeLocale();
    if (job.status === JobStatus.RUNNING && job.started_at) {
      return html`
        <span>•</span>
        <span class="job-time">
          ${this._localize("firmware_jobs.time_started", {
            time: formatRelativeTime(job.started_at, this._now, locale),
          })}
        </span>
      `;
    }
    if (job.status === JobStatus.QUEUED) {
      return html`
        <span>•</span>
        <span class="job-time">
          ${this._localize("firmware_jobs.time_queued", {
            time: formatRelativeTime(job.created_at, this._now, locale),
          })}
        </span>
      `;
    }
    if (isTerminal(job) && job.completed_at) {
      return html`
        <span>•</span>
        <span class="job-time">
          ${this._localize("firmware_jobs.time_finished", {
            time: formatAbsoluteTime(job.completed_at, this._now, locale),
          })}
        </span>
      `;
    }
    return nothing;
  }

  private _startTicker() {
    if (this._tickHandle !== null) return;
    this._tickHandle = setInterval(() => {
      this._now = Date.now();
    }, 30_000);
  }

  private _stopTicker = () => {
    if (this._tickHandle !== null) {
      clearInterval(this._tickHandle);
      this._tickHandle = null;
    }
  };

  /** Sort: running → queued → terminal. Active queued/running by oldest
   *  first (FIFO order); terminal by most-recent first so the latest
   *  finished job is at the top of the history. */
  private _compareJobs = (a: FirmwareJob, b: FirmwareJob) => {
    const rank = (j: FirmwareJob) =>
      j.status === JobStatus.RUNNING
        ? 0
        : j.status === JobStatus.QUEUED
          ? 1
          : 2;
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 2) {
      const ta = a.completed_at ?? a.created_at;
      const tb = b.completed_at ?? b.created_at;
      return tb.localeCompare(ta);
    }
    return a.created_at.localeCompare(b.created_at);
  };

  private _jobDisplayName(job: FirmwareJob): string {
    return firmwareJobDisplayName(job, this._devices, this._localize);
  }

  private _openJob(job: FirmwareJob) {
    this._commandDialog.followJob(job, this._jobDisplayName(job));
  }

  private _onCancelClick(e: Event, job: FirmwareJob) {
    e.stopPropagation();
    this._cancel(job);
  }

  private async _cancel(job: FirmwareJob) {
    try {
      await this._api.firmwareCancel(job.job_id);
    } catch {
      /* The job may have already finished — follow_jobs will reconcile. */
    }
  }

  private _onResetClick() {
    this._confirmDialog.open();
  }

  private async _onResetConfirmed() {
    let job: FirmwareJob;
    try {
      job = await this._api.firmwareResetBuildEnv();
    } catch (err) {
      console.error("Failed to queue reset_build_env job:", err);
      return;
    }
    // Drop the user into the log viewer so they can watch the wipe.
    this._commandDialog.followJob(job, this._jobDisplayName(job));
  }

  private async _onClearHistory() {
    try {
      await this._api.firmwareClear();
    } catch (err) {
      console.error("Failed to clear firmware history:", err);
      return;
    }
    // firmware/clear has no broadcast event — let app-shell prune
    // the local context so the "Recent" group updates immediately.
    this.dispatchEvent(
      new CustomEvent("firmware-history-cleared", {
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-firmware-jobs-dialog": ESPHomeFirmwareJobsDialog;
  }
}
