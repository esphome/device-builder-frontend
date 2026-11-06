import { type FirmwareBinary, JobType } from "../../api/types/firmware-jobs.js";
import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";

/** The install dialog's per-run MD5 state. */
export interface ChecksumState {
  /** Artifact files whose MD5 disclosure is open. */
  expanded: ReadonlySet<string>;
  /** A build ran since the list was read, so its digests may be outdated. */
  stale: boolean;
  /** The picker's list is being re-read; reopening waits for it. */
  reading: boolean;
  /** The row the last download fetched. */
  downloaded?: FirmwareBinary;
  /** That download waited out a build, so the row's digest may be outdated. */
  downloadedStale: boolean;
}

export const initialChecksums = (): ChecksumState => ({
  expanded: new Set(),
  stale: false,
  reading: false,
  downloadedStale: false,
});

export function updateChecksums(
  host: ESPHomeFirmwareInstallDialog,
  patch: Partial<ChecksumState>
): void {
  host._checksums = { ...host._checksums, ...patch };
}

export function toggleMd5(host: ESPHomeFirmwareInstallDialog, file: string): void {
  const expanded = new Set(host._checksums.expanded);
  if (!expanded.delete(file)) expanded.add(file);
  updateChecksums(host, { expanded });
}

/** Whether a job that rewrites the device's build artifacts is running now. */
export function buildRunning(host: ESPHomeFirmwareInstallDialog): boolean {
  const configuration = host._device?.configuration;
  const job =
    configuration === undefined ? undefined : host._activeJobs.get(configuration);
  // An upload only flashes the existing image.
  return job !== undefined && job.job_type !== JobType.UPLOAD;
}

/** Mark the listed digests stale once a build for the device runs under them. */
export function syncChecksumsWithBuilds(host: ESPHomeFirmwareInstallDialog): void {
  if (!host._open || host._binaries.length === 0 || host._checksums.stale) return;
  if (buildRunning(host)) updateChecksums(host, { stale: true });
}
