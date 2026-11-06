import {
  type FirmwareBinary,
  type FirmwareJob,
  JobType,
} from "../../api/types/firmware-jobs.js";
import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";

/** The install dialog's per-run MD5 state. */
export interface ChecksumState {
  /** Artifact files whose MD5 disclosure is open. */
  expanded: ReadonlySet<string>;
  /** A build ran since the list was read, so its digests may be outdated. */
  stale: boolean;
  /** The list is being read; reopening waits for it. */
  reading: boolean;
  /** The build entry present when the read started, already finished for this flow. */
  priorBuild?: string;
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

/** The running job that rewrites the device's build artifacts, if any. */
export function runningBuild(
  host: ESPHomeFirmwareInstallDialog
): FirmwareJob | undefined {
  const configuration = host._device?.configuration;
  const job =
    configuration === undefined ? undefined : host._activeJobs.get(configuration);
  // An upload only flashes the existing image.
  return job?.job_type === JobType.UPLOAD ? undefined : job;
}

export const buildRunning = (host: ESPHomeFirmwareInstallDialog): boolean =>
  runningBuild(host) !== undefined;

/** Mark the digests stale once a new build for the device runs during or after their read. */
export function syncChecksumsWithBuilds(host: ESPHomeFirmwareInstallDialog): void {
  const { stale, reading, priorBuild } = host._checksums;
  if (!host._open || stale || (!reading && host._binaries.length === 0)) return;
  const job = runningBuild(host);
  // The flow's own compile can still be listed after its result arrived.
  if (job !== undefined && job.job_id !== priorBuild)
    updateChecksums(host, { stale: true });
}
