import { consume } from "@lit/context";
import {
  mdiBroom,
  mdiClockOutline,
  mdiClose,
  mdiHammerWrench,
  mdiPlaylistRemove,
  mdiUpload,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import { JobStatus, JobType } from "../api/types.js";
import type { ConfiguredDevice, FirmwareJob } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  apiContext,
  devicesContext,
  firmwareJobsContext,
  localizeContext,
} from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";

registerMdiIcons({
  broom: mdiBroom,
  "clock-outline": mdiClockOutline,
  close: mdiClose,
  "hammer-wrench": mdiHammerWrench,
  "playlist-remove": mdiPlaylistRemove,
  upload: mdiUpload,
});

const TYPE_ICONS: Record<JobType, string> = {
  [JobType.COMPILE]: "hammer-wrench",
  [JobType.UPLOAD]: "upload",
  [JobType.INSTALL]: "upload",
  [JobType.CLEAN]: "broom",
};

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

  open() {
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  static styles = [
    espHomeStyles,
    css`
      wa-dialog {
        --width: min(560px, 95vw);
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
        padding: var(--wa-space-s);
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
        gap: var(--wa-space-2xs);
      }

      .job {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: var(--wa-space-s);
        padding: var(--wa-space-s) var(--wa-space-m);
        border-radius: var(--wa-border-radius-m);
        transition: background 0.1s;
      }

      .job:hover {
        background: var(--wa-color-surface-lowered);
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

      .cancel-btn {
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
        transition:
          background 0.1s,
          color 0.1s;
      }

      .cancel-btn:hover {
        background: color-mix(in srgb, var(--esphome-error), transparent 90%);
        color: var(--esphome-error);
      }

      .cancel-btn wa-icon {
        font-size: 18px;
      }
    `,
  ];

  protected render() {
    const jobs = [...this._jobs.values()].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
    return html`
      <wa-dialog light-dismiss label=${this._localize("firmware_jobs.title")}>
        ${jobs.length === 0 ? this._renderEmpty() : this._renderJobs(jobs)}
      </wa-dialog>
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

  private _renderJobs(jobs: FirmwareJob[]) {
    return html`<div class="jobs">${jobs.map((j) => this._renderJob(j))}</div>`;
  }

  private _renderJob(job: FirmwareJob) {
    const device = this._devices.find((d) => d.configuration === job.configuration);
    const name = device?.friendly_name || device?.name || job.configuration;
    const typeIcon = TYPE_ICONS[job.job_type] ?? "hammer-wrench";
    const typeLabel = this._localize(`firmware_jobs.type_${job.job_type}`);
    const showProgress =
      job.status === JobStatus.RUNNING && typeof job.progress === "number";

    return html`
      <div class="job">
        <div class="job-icon">
          <wa-icon library="mdi" name=${typeIcon}></wa-icon>
        </div>
        <div class="job-content">
          <div class="job-name">${name}</div>
          <div class="job-meta">
            <span>${typeLabel}</span>
            <span>•</span>
            ${this._renderStatus(job)}
          </div>
          ${showProgress
            ? html`
                <div class="progress">
                  <div class="progress-fill" style="width:${job.progress}%"></div>
                </div>
              `
            : nothing}
        </div>
        <button
          class="cancel-btn"
          title=${this._localize("firmware_jobs.cancel")}
          aria-label=${this._localize("firmware_jobs.cancel")}
          @click=${() => this._cancel(job)}
        >
          <wa-icon library="mdi" name="close"></wa-icon>
        </button>
      </div>
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
    return nothing;
  }

  private async _cancel(job: FirmwareJob) {
    try {
      await this._api.firmwareCancel(job.job_id);
    } catch {
      /* The job may have already finished — follow_jobs will reconcile. */
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-firmware-jobs-dialog": ESPHomeFirmwareJobsDialog;
  }
}
