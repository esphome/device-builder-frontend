import { JobStatus } from "../api/types.js";
import type { FirmwareJob } from "../api/types.js";

/**
 * The set of ``JobStatus`` values the backend treats as terminal —
 * a job in any of these has finished and won't transition again.
 * Mirrors the backend's ``TERMINAL_STATUSES`` (controllers/firmware).
 *
 * Keep this single source of truth so UI surfaces that gate on
 * "is this job done?" can't drift apart (the dashboard's job
 * deduplication, the firmware-tasks dialog row classification,
 * and the command dialog's reattach guard all want the same
 * answer).
 */
export const TERMINAL_JOB_STATUSES: ReadonlySet<JobStatus> = new Set([
  JobStatus.COMPLETED,
  JobStatus.FAILED,
  JobStatus.CANCELLED,
]);

/**
 * True when *status* is one of the terminal job statuses
 * (COMPLETED / FAILED / CANCELLED). ``null`` / ``undefined`` —
 * meaning we haven't observed the job's status yet — counts as
 * non-terminal so the caller waits for an actual signal.
 */
export function isTerminalJobStatus(status: JobStatus | null | undefined): boolean {
  return status != null && TERMINAL_JOB_STATUSES.has(status);
}

/** Convenience overload of :func:`isTerminalJobStatus` for a whole job. */
export function isTerminalJob(job: FirmwareJob): boolean {
  return TERMINAL_JOB_STATUSES.has(job.status);
}
