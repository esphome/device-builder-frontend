import { JobStatus, JobType, type FirmwareJob } from "../../api/types.js";
import { isTerminalJobStatus } from "../../util/firmware-job-status.js";
import type { ESPHomeApp } from "../app-shell.js";

// Mirrors the backend's _PRIMARY_JOB_TYPES retention pool — job types
// deduplicated to one terminal entry per device.
const PRIMARY_JOB_TYPES: ReadonlySet<JobType> = new Set([
  JobType.COMPILE,
  JobType.UPLOAD,
  JobType.INSTALL,
]);

// How long a terminated job stays in _recentJobs so the dashboard can flash a
// status indicator. Successful completions revert quickly so the device's real
// online/offline state isn't masked; failed/cancelled linger so the user notices.
const RECENT_JOB_TTL_MS_COMPLETED = 10_000;
const RECENT_JOB_TTL_MS_ATTENTION = 30_000;

// Extra _activeJobs keys to mirror a job under, beyond job.configuration.
// Today only RENAME needs it: the new YAML appears mid-flight and the
// soon-to-be-named device card needs to find the live job too.
export function renameKeys(job: FirmwareJob): string[] {
  if (job.job_type !== JobType.RENAME) return [];
  if (!job.new_name) return [];
  const extMatch = job.configuration.match(/\.ya?ml$/);
  const ext = extMatch ? extMatch[0] : ".yaml";
  const renamed = `${job.new_name}${ext}`;
  return renamed === job.configuration ? [] : [renamed];
}

export function clearRecentJobs(host: ESPHomeApp): void {
  for (const timer of host._recentJobTimers.values()) clearTimeout(timer);
  host._recentJobTimers.clear();
  host._recentJobs = new Map();
}

export function subscribeToFollowJobs(host: ESPHomeApp): void {
  host._activeJobs = new Map();
  host._firmwareJobs = new Map();
  clearRecentJobs(host);
  try {
    host._api.firmwareFollowJobs((event, data) => handleJobEvent(host, event, data));
  } catch (err) {
    console.error("Failed to follow firmware jobs:", err);
  }
}

export function handleJobEvent(host: ESPHomeApp, event: string, data: unknown): void {
  switch (event) {
    case "snapshot":
    case "job_queued":
    case "job_started":
      upsertJob(host, data as FirmwareJob);
      break;
    case "job_completed":
    case "job_failed":
    case "job_cancelled":
      terminateJob(host, data as FirmwareJob);
      break;
    case "job_progress": {
      const { job_id, progress } = data as { job_id: string; progress: number };
      const existing = host._firmwareJobs.get(job_id);
      if (!existing) return;
      const updated = { ...existing, progress };
      const next = new Map(host._firmwareJobs);
      next.set(job_id, updated);
      host._firmwareJobs = next;
      if (host._activeJobs.get(updated.configuration)?.job_id === job_id) {
        const active = new Map(host._activeJobs);
        active.set(updated.configuration, updated);
        host._activeJobs = active;
      }
      break;
    }
    // job_output is handled per-job via firmware/follow_job in command-dialog.
  }
}

function upsertJob(host: ESPHomeApp, job: FirmwareJob): void {
  const next = new Map(host._firmwareJobs);
  next.set(job.job_id, job);
  host._firmwareJobs = next;
  // Snapshots replay terminal jobs too — those belong only in history.
  if (isTerminalJobStatus(job.status)) return;
  const active = new Map(host._activeJobs);
  active.set(job.configuration, job);
  // Mirror under the new key so the soon-to-be-renamed device card finds the job.
  for (const key of renameKeys(job)) active.set(key, job);
  host._activeJobs = active;
}

// Terminal: keep in _firmwareJobs history; drop older terminal for same device
// (re-compile replaces rather than stacks); clear per-device active slot.
// Cancellations with a live successor are a backend supersede — drop silently.
function terminateJob(host: ESPHomeApp, job: FirmwareJob): void {
  if (job.status === JobStatus.CANCELLED && job.configuration) {
    const supersededByActive = [...host._firmwareJobs.values()].some(
      (j) =>
        j.job_id !== job.job_id &&
        j.configuration === job.configuration &&
        !isTerminalJobStatus(j.status)
    );
    if (supersededByActive) {
      const next = new Map(host._firmwareJobs);
      next.delete(job.job_id);
      host._firmwareJobs = next;
      return;
    }
  }
  const next = new Map(host._firmwareJobs);
  next.set(job.job_id, job);
  if (PRIMARY_JOB_TYPES.has(job.job_type) && job.configuration) {
    for (const [id, existing] of next) {
      if (id === job.job_id) continue;
      if (
        PRIMARY_JOB_TYPES.has(existing.job_type) &&
        existing.configuration === job.configuration &&
        isTerminalJobStatus(existing.status)
      ) {
        next.delete(id);
      }
    }
  }
  host._firmwareJobs = next;
  // Only clear active slot when it points at *this* job — a freshly-queued
  // follow-up for the same device must stay visible.
  let active: Map<string, FirmwareJob> | null = null;
  if (host._activeJobs.get(job.configuration)?.job_id === job.job_id) {
    active = new Map(host._activeJobs);
    active.delete(job.configuration);
  }
  for (const key of renameKeys(job)) {
    if (host._activeJobs.get(key)?.job_id !== job.job_id) continue;
    active = active ?? new Map(host._activeJobs);
    active.delete(key);
  }
  if (active !== null) host._activeJobs = active;
  if (job.configuration) markJobRecent(host, job);
}

function markJobRecent(host: ESPHomeApp, job: FirmwareJob): void {
  const recent = new Map(host._recentJobs);
  recent.set(job.configuration, job);
  host._recentJobs = recent;

  const prevTimer = host._recentJobTimers.get(job.configuration);
  if (prevTimer !== undefined) clearTimeout(prevTimer);

  const ttl =
    job.status === JobStatus.COMPLETED
      ? RECENT_JOB_TTL_MS_COMPLETED
      : RECENT_JOB_TTL_MS_ATTENTION;
  const timer = setTimeout(() => {
    host._recentJobTimers.delete(job.configuration);
    if (host._recentJobs.get(job.configuration)?.job_id !== job.job_id) return;
    const next = new Map(host._recentJobs);
    next.delete(job.configuration);
    host._recentJobs = next;
  }, ttl);
  host._recentJobTimers.set(job.configuration, timer);
}

export function onFirmwareHistoryCleared(host: ESPHomeApp): void {
  // firmware/clear doesn't broadcast — prune retained terminals locally.
  const next = new Map<string, FirmwareJob>();
  for (const [id, job] of host._firmwareJobs) {
    if (!isTerminalJobStatus(job.status)) next.set(id, job);
  }
  host._firmwareJobs = next;
  clearRecentJobs(host);
}
