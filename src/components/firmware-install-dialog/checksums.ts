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
  /** Artifact-writing builds seen for the device while the dialog is open. */
  builds: number;
  /** The last build counted, so each job counts once. */
  lastBuild?: string;
  /** The builds count when the listed digests were read. */
  listedAt: number;
  /** The list is being read; reopening waits for it. */
  reading: boolean;
  /** The row the last download fetched, and whether a build had replaced its digest. */
  downloaded?: { binary: FirmwareBinary; stale: boolean };
}

export const initialChecksums = (): ChecksumState => ({
  expanded: new Set(),
  builds: 0,
  listedAt: 0,
  reading: false,
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

/** Whether a build ran during or after the read of the listed digests. */
export const listStale = (host: ESPHomeFirmwareInstallDialog): boolean =>
  host._checksums.builds !== host._checksums.listedAt;

/** Count each artifact-writing build the open dialog sees, once per job. */
export function syncChecksumsWithBuilds(host: ESPHomeFirmwareInstallDialog): void {
  const job = runningBuild(host);
  if (!host._open || job === undefined || job.job_id === host._checksums.lastBuild)
    return;
  updateChecksums(host, { builds: host._checksums.builds + 1, lastBuild: job.job_id });
}
