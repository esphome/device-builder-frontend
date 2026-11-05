import type { FirmwareBinary } from "../../api/types/firmware-jobs.js";
import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";
import { runGuard } from "./install-flow.js";

/** The install dialog's per-run MD5 state. */
export interface ChecksumState {
  /** Artifact files whose MD5 disclosure is open. */
  expanded: ReadonlySet<string>;
  /** A build or digest re-read is replacing the shown checksums. */
  pending: boolean;
  /** The last digest re-read failed, so the checksums were dropped. */
  unavailable: boolean;
  /** The artifact ``file`` the last download fetched. */
  downloadedFile: string;
  /** The in-flight digest re-read every caller in this run shares. */
  refresh?: Promise<boolean>;
}

export const initialChecksums = (): ChecksumState => ({
  expanded: new Set(),
  pending: false,
  unavailable: false,
  downloadedFile: "",
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

// A build that finished while the picker sat open replaced the files; re-read
// the checksum metadata so a copied MD5 matches what downloads. A failed
// re-read drops the digests rather than show ones that may be stale. Callers
// in one run share the in-flight read. False when the dialog was closed or
// reopened meanwhile.
export function refreshDigests(
  host: ESPHomeFirmwareInstallDialog,
  configuration: string
): Promise<boolean> {
  if (host._binaries.length === 0) return Promise.resolve(true);
  if (!host._checksums.refresh) {
    const refresh = readDigests(host, configuration).finally(() => {
      if (host._checksums.refresh === refresh)
        updateChecksums(host, { refresh: undefined });
    });
    updateChecksums(host, { refresh });
  }
  return host._checksums.refresh!;
}

async function readDigests(
  host: ESPHomeFirmwareInstallDialog,
  configuration: string
): Promise<boolean> {
  const stillCurrent = runGuard(host);
  let fresh: FirmwareBinary[] | null;
  try {
    fresh = await host._api.firmwareGetBinaries(configuration);
  } catch (err) {
    console.warn("Could not refresh firmware digests", err);
    fresh = null;
  }
  if (!stillCurrent()) return false;
  const byFile = new Map((fresh ?? []).map((binary) => [binary.file, binary]));
  host._binaries = host._binaries.map((binary) => {
    const latest = byFile.get(binary.file);
    return {
      ...binary,
      download_name: latest?.download_name ?? binary.download_name,
      md5: latest?.md5,
    };
  });
  updateChecksums(host, {
    unavailable: fresh === null,
    pending: host._activeJobs.has(configuration),
  });
  return true;
}

/**
 * Hold the shown checksums while a build for the device runs, and re-read
 * them once it ends, so the picker and download-ready never offer a digest
 * of artifacts a build just replaced.
 */
export function syncChecksumsWithBuilds(host: ESPHomeFirmwareInstallDialog): void {
  const configuration = host._device?.configuration;
  if (!configuration || host._binaries.length === 0) return;
  if (host._activeJobs.has(configuration)) {
    if (!host._checksums.pending) updateChecksums(host, { pending: true });
  } else if (host._checksums.pending) {
    void refreshDigests(host, configuration);
  }
}
