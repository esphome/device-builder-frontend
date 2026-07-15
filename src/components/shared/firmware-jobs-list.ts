import { html, nothing, type TemplateResult } from "lit";
import {
  type FirmwareJob,
  JobSource,
  JobStatus,
  JobType,
} from "../../api/types/firmware-jobs.js";
import { activeLocale, type LocalizeFunc } from "../../common/localize.js";
import { effectiveJobType } from "../../util/firmware-job-display.js";
import { isTerminalJob as isTerminal } from "../../util/firmware-job-status.js";
import { formatAbsoluteTime, formatRelativeTime } from "../../util/format-job-time.js";

/**
 * What a host must expose to render the shared jobs list.
 *
 * Both the firmware-jobs dialog and the remote-build panel implement this;
 * the row markup and grouping live here so the two stay pixel-identical.
 */
export interface FirmwareJobsListHost {
  _localize: LocalizeFunc;
  /** Wall-clock anchor for relative timestamps; hosts tick it while visible. */
  _now: number;
  _jobDisplayName(job: FirmwareJob): string;
  _openJob(job: FirmwareJob): void;
  _onCancelClick(e: Event, job: FirmwareJob): void;
}

const TYPE_ICONS: Record<JobType, string> = {
  [JobType.COMPILE]: "hammer-wrench",
  [JobType.UPLOAD]: "upload",
  [JobType.INSTALL]: "upload",
  [JobType.CLEAN]: "broom",
  [JobType.RESET_BUILD_ENV]: "cog-refresh",
  [JobType.RENAME]: "rename-outline",
};

/** Sort + split a jobs Map into active / terminal lists; wrap in memoizeOne per host. */
export function bucketJobs(jobs: Map<string, FirmwareJob>): {
  sorted: FirmwareJob[];
  active: FirmwareJob[];
  terminal: FirmwareJob[];
} {
  const sorted = [...jobs.values()].sort(compareJobs);
  return {
    sorted,
    active: sorted.filter((j) => !isTerminal(j)),
    terminal: sorted.filter((j) => isTerminal(j)),
  };
}

export function renderEmpty(localize: LocalizeFunc): TemplateResult {
  return html`
    <div class="empty">
      <wa-icon library="mdi" name="playlist-remove"></wa-icon>
      <div class="empty-title">${localize("firmware_jobs.empty_title")}</div>
      <div class="empty-desc">${localize("firmware_jobs.empty_desc")}</div>
    </div>
  `;
}

export function renderGroups(
  host: FirmwareJobsListHost,
  active: FirmwareJob[],
  terminal: FirmwareJob[]
): TemplateResult {
  return html`
    <div class="jobs">
      ${
        active.length > 0
          ? html`
              <div class="group-label">
                ${host._localize("firmware_jobs.group_active")}
              </div>
              ${active.map((j) => renderJob(host, j))}
            `
          : nothing
      }
      ${
        terminal.length > 0
          ? html`
              <div class="group-label">
                ${host._localize("firmware_jobs.group_history")}
              </div>
              ${terminal.map((j) => renderJob(host, j))}
            `
          : nothing
      }
    </div>
  `;
}

function renderJob(host: FirmwareJobsListHost, job: FirmwareJob): TemplateResult {
  const name = host._jobDisplayName(job);
  const effectiveType = effectiveJobType(job);
  const typeIcon = TYPE_ICONS[effectiveType] ?? "hammer-wrench";
  const typeLabel = host._localize(`firmware_jobs.type_${effectiveType}`);
  const showProgress =
    job.status === JobStatus.RUNNING && typeof job.progress === "number";
  const terminal = isTerminal(job);

  return html`
    <button class="job" @click=${() => host._openJob(job)}>
      <div class="job-icon ${terminal ? "job-icon--terminal" : ""}">
        <wa-icon library="mdi" name=${typeIcon}></wa-icon>
      </div>
      <div class="job-content">
        <div class="job-name">${name}</div>
        <div class="job-meta">
          <span>${typeLabel}</span>
          <span>•</span>
          ${renderStatus(host, job)} ${renderTimestamp(host, job)}
        </div>
        ${renderSourceLine(host, job)}
        ${
          showProgress
            ? html`
                <div class="progress">
                  <div class="progress-fill" style="width:${job.progress}%"></div>
                </div>
              `
            : nothing
        }
      </div>
      ${renderRowAction(host, job)}
    </button>
  `;
}

function renderRowAction(host: FirmwareJobsListHost, job: FirmwareJob): TemplateResult {
  if (job.status === JobStatus.COMPLETED) {
    return html`
      <span
        class="row-status-icon row-status-icon--success"
        aria-label=${host._localize("firmware_jobs.status_completed")}
      >
        <wa-icon library="mdi" name="check-circle"></wa-icon>
      </span>
    `;
  }
  if (job.status === JobStatus.FAILED) {
    return html`
      <span
        class="row-status-icon row-status-icon--error"
        aria-label=${host._localize("firmware_jobs.status_failed")}
      >
        <wa-icon library="mdi" name="close-circle"></wa-icon>
      </span>
    `;
  }
  if (job.status === JobStatus.CANCELLED) {
    return html`
      <span
        class="row-status-icon row-status-icon--cancelled"
        aria-label=${host._localize("firmware_jobs.status_cancelled")}
      >
        <wa-icon library="mdi" name="cancel"></wa-icon>
      </span>
    `;
  }
  return html`
    <button
      class="row-action"
      title=${host._localize("firmware_jobs.cancel")}
      aria-label=${host._localize("firmware_jobs.cancel")}
      @click=${(e: Event) => host._onCancelClick(e, job)}
    >
      <wa-icon library="mdi" name="close"></wa-icon>
    </button>
  `;
}

// Picked up from source_label (snapshotted at job creation) so the row text
// doesn't churn if the pairing is later renamed. Symmetric receiver-side
// rendering: when remote_peer is set, the job was submitted from another
// dashboard's offloader.
// Exported for unit testing of the per-source row line (building-on /
// waiting-for-server / submitted-by).
export function renderSourceLine(
  host: FirmwareJobsListHost,
  job: FirmwareJob
): TemplateResult | typeof nothing {
  if (job.source === JobSource.REMOTE && job.source_label) {
    const display = job.source_esphome_version
      ? `${job.source_label} (${job.source_esphome_version})`
      : job.source_label;
    return html`
      <div class="job-source">
        ${host._localize("firmware_jobs.building_on", {
          label: display,
        })}
      </div>
    `;
  }
  // No server bound yet: the compile is waiting for one to free up.
  if (job.source === JobSource.REMOTE_PENDING) {
    return html`
      <div class="job-source">
        ${host._localize("firmware_jobs.waiting_for_build_server")}
      </div>
    `;
  }
  if (job.remote_peer) {
    const peer = job.remote_peer_label || job.remote_peer;
    return html`
      <div class="job-source">
        ${host._localize("firmware_jobs.submitted_by", { label: peer })}
      </div>
    `;
  }
  return nothing;
}

function renderStatus(
  host: FirmwareJobsListHost,
  job: FirmwareJob
): TemplateResult | typeof nothing {
  if (job.status === JobStatus.RUNNING) {
    return html`
      <span class="job-status">
        <wa-spinner></wa-spinner>
        ${
          typeof job.progress === "number"
            ? `${job.progress}%`
            : host._localize("firmware_jobs.status_running")
        }
      </span>
    `;
  }
  if (job.status === JobStatus.QUEUED) {
    return html`
      <span class="job-status">
        <wa-icon library="mdi" name="clock-outline"></wa-icon>
        ${host._localize("firmware_jobs.status_queued")}
      </span>
    `;
  }
  if (job.status === JobStatus.COMPLETED) {
    return html`
      <span class="job-status job-status--success">
        ${host._localize("firmware_jobs.status_completed")}
      </span>
    `;
  }
  if (job.status === JobStatus.FAILED) {
    return html`
      <span class="job-status job-status--error">
        ${host._localize("firmware_jobs.status_failed")}
      </span>
    `;
  }
  if (job.status === JobStatus.CANCELLED) {
    return html`
      <span class="job-status">
        ${host._localize("firmware_jobs.status_cancelled")}
      </span>
    `;
  }
  return nothing;
}

// Active rows show relative ("started 2m ago") that ticks with _now;
// terminal rows show absolute ("finished HH:MM") since the moment is fixed.
function renderTimestamp(
  host: FirmwareJobsListHost,
  job: FirmwareJob
): TemplateResult | typeof nothing {
  const locale = activeLocale();
  if (job.status === JobStatus.RUNNING && job.started_at) {
    return html`
      <span>•</span>
      <span class="job-time">
        ${host._localize("firmware_jobs.time_started", {
          time: formatRelativeTime(job.started_at, host._now, locale),
        })}
      </span>
    `;
  }
  if (job.status === JobStatus.QUEUED) {
    return html`
      <span>•</span>
      <span class="job-time">
        ${host._localize("firmware_jobs.time_queued", {
          time: formatRelativeTime(job.created_at, host._now, locale),
        })}
      </span>
    `;
  }
  if (isTerminal(job) && job.completed_at) {
    return html`
      <span>•</span>
      <span class="job-time">
        ${host._localize("firmware_jobs.time_finished", {
          time: formatAbsoluteTime(job.completed_at, host._now, locale),
        })}
      </span>
    `;
  }
  return nothing;
}

// running → queued → terminal. Active by oldest first (FIFO); terminal by
// most recent first so the latest finished job tops the history.
function compareJobs(a: FirmwareJob, b: FirmwareJob): number {
  const rank = (j: FirmwareJob) =>
    j.status === JobStatus.RUNNING ? 0 : j.status === JobStatus.QUEUED ? 1 : 2;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 2) {
    const ta = a.completed_at ?? a.created_at;
    const tb = b.completed_at ?? b.created_at;
    return tb.localeCompare(ta);
  }
  return a.created_at.localeCompare(b.created_at);
}
