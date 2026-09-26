import {
  type FirmwareBinary,
  JobSource,
  JobStatus,
} from "../../api/types/firmware-jobs.js";
import { OTA_PORT } from "../../api/types/streaming.js";
import { triggerDownload } from "../../util/download-text.js";
import { pairingDisplayNameForPin } from "../../util/pairing-display-name.js";
import { dispatchShowLogsAfterInstall } from "../../util/post-install-logs.js";
import { resumeFollowOnReady } from "../../util/resume-follow.js";
import { isValidationFailureLine } from "../../util/validation-log.js";
import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";

export function compileFailureDetail(err: unknown): string {
  return err instanceof Error ? err.message.trim() : String(err ?? "").trim();
}

/**
 * A browser flash finished with ``port`` in hand: Done offers its logs, and
 * flips to them at once when asked. Not for a dialog dismissed mid-flash
 * (_cancel closes the UI without interrupting the flash loop, so the logs
 * would pop up on a user who walked away), nor while ``boardUp`` is false
 * (the caller has a notice to show first).
 */
export function finishWithLogsPort(
  host: ESPHomeFirmwareInstallDialog,
  port: SerialPort,
  boardUp = true
): void {
  host._logsPort = port;
  host._step = "done";
  if (boardUp && host._open && host._showLogsAfterInstall) flipToLogs(host, port);
}

export function flipToLogs(
  host: ESPHomeFirmwareInstallDialog,
  webSerialPort: SerialPort
): void {
  const device = host._device;
  if (!device) return;
  const handled = dispatchShowLogsAfterInstall(host, {
    configuration: device.configuration,
    name: device.friendly_name || device.name,
    webSerialPort,
    // Raw baud; the logs handler resolves it (0 ⇒ disabled, skip with a notice).
    loggerBaudRate: device.logger_baud_rate,
    loggerInterface: device.logger_interface,
    targetPlatform: device.target_platform,
    reopenInstall: () => host.reopen(),
  });
  if (handled) host._open = false;
}

// Web-flash logs go over OTA/native-API: the serial port lived in the external
// flasher tab, so there's nothing local to read.
export function showOtaLogs(host: ESPHomeFirmwareInstallDialog): void {
  const device = host._device;
  if (!device) return;
  const handled = dispatchShowLogsAfterInstall(host, {
    configuration: device.configuration,
    name: device.friendly_name || device.name,
    port: OTA_PORT,
    reopenInstall: () => host.reopen(),
  });
  if (handled) host._open = false;
}

// Compile, surfacing a failure on the dialog. Returns false so the caller bails.
export async function compileOrFail(
  host: ESPHomeFirmwareInstallDialog,
  configuration: string
): Promise<boolean> {
  try {
    await compileAndWait(host, configuration);
    return true;
  } catch (err) {
    // ??= so a "validate" already recorded off the output stream survives.
    host._failureKind ??= "compile";
    host._fail(host._localize("firmware.compile_failed"), compileFailureDetail(err));
    return false;
  }
}

// List build artefacts, surfacing a failure on the dialog. Returns null so the
// caller bails.
export async function fetchBinaries(
  host: ESPHomeFirmwareInstallDialog,
  configuration: string
): Promise<FirmwareBinary[] | null> {
  try {
    return await host._api.firmwareGetBinaries(configuration);
  } catch {
    host._fail(host._localize("firmware.download_failed"));
    return null;
  }
}

function showBinaryPicker(
  host: ESPHomeFirmwareInstallDialog,
  binaries: FirmwareBinary[]
): void {
  host._binaries = binaries;
  host._statusMessage = "";
  host._step = "choose-binary";
}

// Reached after a *successful* compile when there's nothing to flash. A remote
// build that returned an EMPTY list is a packaging / transfer problem on the
// build server, so name it. Binaries that came back but aren't web-flashable
// (e.g. only OTA / uf2) transferred fine — that's a web.esphome.io format
// limit, so they keep the flashable-binary message regardless of build origin.
export function failNoBinaries(
  host: ESPHomeFirmwareInstallDialog,
  { isWebFlasher, isEmpty }: { isWebFlasher: boolean; isEmpty: boolean }
): void {
  if (isEmpty && host._jobSource === JobSource.REMOTE) {
    const receiver =
      pairingDisplayNameForPin(
        host._pairings,
        host._jobSourcePin,
        host._jobSourceLabel
      ) || host._localize("firmware.no_binaries_remote_server");
    host._fail(
      host._localize("firmware.no_binaries_remote", { receiver }),
      host._localize("firmware.no_binaries_remote_detail")
    );
    return;
  }
  host._fail(
    host._localize(isWebFlasher ? "firmware.no_flashable_binary" : "firmware.no_binaries")
  );
}

// The manual binary download: compile, then hand over whatever the build
// produced (incl. .uf2). More than one format routes to the choose-binary
// picker so every image stays reachable.
export async function startDownload(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const device = host._device;
  if (!device) return;

  if (!(await compileOrFail(host, device.configuration))) return;
  host._statusMessage = host._localize("firmware.status_downloading");
  const binaries = await fetchBinaries(host, device.configuration);
  if (!binaries) return;

  if (binaries.length > 1) {
    showBinaryPicker(host, binaries);
    return;
  }
  if (binaries.length === 0) {
    failNoBinaries(host, { isWebFlasher: false, isEmpty: true });
    return;
  }
  await downloadSelectedBinary(host, binaries[0].file);
}

// Three-dot "Download". Compiles only when nothing is built, so an existing
// build's ELF still matches the firmware flashed on the device.
export async function startArtifactDownload(
  host: ESPHomeFirmwareInstallDialog
): Promise<void> {
  const device = host._device;
  if (!device) return;

  if (!(await artifactsSettled(host, device.configuration))) return;

  let binaries = await fetchBinaries(host, device.configuration);
  if (!binaries) return;
  if (binaries.length === 0) {
    if (!(await compileOrFail(host, device.configuration))) return;
    host._statusMessage = host._localize("firmware.status_downloading");
    binaries = await fetchBinaries(host, device.configuration);
    if (!binaries) return;
  }

  if (binaries.length === 0) {
    failNoBinaries(host, { isWebFlasher: false, isEmpty: true });
    return;
  }
  if (binaries.length === 1) {
    await downloadSelectedBinary(host, binaries[0].file);
    return;
  }
  showBinaryPicker(host, binaries);
}

// Fetch one binary and hand it to the browser. Shared by the auto-select
// paths and the picker; leaves _binaries intact for "download another format".
// Re-settles at select time: the picker (or download-ready's "another
// format") can sit open while a new build starts rewriting the file.
export async function downloadSelectedBinary(
  host: ESPHomeFirmwareInstallDialog,
  file: string
): Promise<void> {
  const device = host._device;
  if (!device) return;
  if (!(await artifactsSettled(host, device.configuration))) return;
  host._statusMessage = host._localize("firmware.status_downloading");
  // Distinct from the compile steps: the byte fetch isn't cancelable, so the
  // footer must not offer Stop (see renderFooter).
  host._step = "downloading";
  try {
    const { url, filename } = await host._api.firmwareDownloadUrl(
      device.configuration,
      file
    );
    triggerDownload(url, filename);
    host._downloadedFilename = filename;
  } catch {
    host._fail(host._localize("firmware.download_failed"));
    return;
  }
  host._step = "download-ready";
  host._statusMessage = "";
}

/**
 * Wait out any running job for *configuration* before touching its
 * artifacts — a running build both rewrites the files a download would
 * read and would be superseded (cancelled + restarted) by a fresh
 * compile (#1200).
 *
 * True to proceed; false when the wait didn't complete (dialog dismissed,
 * or the follow stream errored and the dialog already shows the failure).
 */
async function artifactsSettled(
  host: ESPHomeFirmwareInstallDialog,
  configuration: string
): Promise<boolean> {
  const running = host._activeJobs.get(configuration);
  if (!running) return true;
  host._statusMessage = host._localize("firmware.status_waiting_build");
  if (!(await waitForRunningJob(host, running.job_id))) return false;
  host._statusMessage = host._localize("firmware.status_downloading");
  return true;
}

/**
 * Stream an already-running job into the dialog and wait for it to reach
 * a terminal state.
 *
 * Deliberately never sets ``host._jobId``: the dialog doesn't own this
 * job, so dismissing the dialog must not cancel it — teardown only
 * stops the follow stream. Resolves true on ANY terminal outcome (a
 * failed or cancelled build just means the caller compiles fresh
 * afterwards); false when the dialog was dismissed mid-wait, or on a
 * follow-stream error — a dead stream says nothing about the job, so
 * proceeding could still read torn artifacts or supersede it. The error
 * case fails the dialog with *failKey*; a retry re-reads the active-jobs
 * map.
 */
export function waitForRunningJob(
  host: ESPHomeFirmwareInstallDialog,
  jobId: string,
  failKey = "firmware.download_failed"
): Promise<boolean> {
  return new Promise((resolve) => {
    host._compileReject = () => resolve(false);
    const follow = (): void => {
      host._streamId = host._api.firmwareFollowJob(jobId, {
        onOutput: (line) => {
          if (host._step === "queued") host._step = "compiling";
          host._timer.noteLine(line);
          host._log.enqueue(line);
        },
        onResult: () => {
          host._streamId = "";
          host._compileReject = null;
          host._log.flush();
          resolve(true);
        },
        onError: () => {
          host._streamId = "";
          host._compileReject = null;
          host._fail(host._localize(failKey));
          resolve(false);
        },
        onConnectionLost: () => {
          host._streamId = "";
          resumeFollowOnReady(host._api, {
            // A dismissal settled the wait and nulled the reject hook.
            isStale: () => host._compileReject === null || host._streamId !== "",
            resume: () => {
              host._log.reset();
              follow();
            },
            giveUp: () => {
              host._compileReject = null;
              host._fail(host._localize(failKey));
              resolve(false);
            },
          });
        },
      });
    };
    follow();
  });
}

export function compileAndWait(
  host: ESPHomeFirmwareInstallDialog,
  configuration: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Capture reject on the dialog so a mid-flight detach (header-X / Escape /
    // reopen) can settle this promise. followJob callbacks clear the hook to
    // null on fire so a normal completion doesn't double-reject on teardown.
    host._compileReject = reject;
    const follow = (jobId: string): void => {
      host._streamId = host._api.firmwareFollowJob(jobId, {
        onOutput: (line) => {
          if (host._step === "queued") {
            host._step = "compiling";
            host._statusMessage = host._localize("firmware.status_compiling");
          }
          host._timer.noteLine(line);
          host._log.enqueue(line);
          if (isValidationFailureLine(line)) host._failureKind = "validate";
        },
        onResult: (data) => {
          host._streamId = "";
          host._jobId = "";
          host._compileReject = null;
          host._log.flush();
          const result = data as unknown as {
            status: string;
            error?: string | null;
          };
          if (result.status === JobStatus.COMPLETED) {
            resolve();
            return;
          }
          // Prefer backend's specific error text so the banner names the cause
          // ("remote build: peer-link session lost (transport_error: …)")
          // instead of a generic "Install failed.".
          reject(new Error(result.error || ""));
        },
        onError: (error) => {
          host._streamId = "";
          host._jobId = "";
          host._compileReject = null;
          reject(new Error(error));
        },
        onConnectionLost: () => {
          host._streamId = "";
          resumeFollowOnReady(host._api, {
            // The submit gap (await firmwareCompile) means a retry can
            // arm before its follow attaches; the job id pins ownership.
            isStale: () => host._jobId !== jobId || host._streamId !== "",
            resume: () => {
              host._log.reset();
              follow(jobId);
            },
            giveUp: () => {
              host._jobId = "";
              host._compileReject = null;
              reject(new Error(host._localize("command.connection_interrupted")));
            },
          });
        },
      });
    };
    // Not an async executor (no-misused-promises): an async function
    // where the constructor expects a void-returning one.
    const start = async () => {
      const job = await host._api.firmwareCompile(configuration);
      host._jobId = job.job_id;
      // Capture so a compile failure can pick the right hint variant:
      // local jobs get the link-to-reset, remote jobs get the plain-text
      // "ask the operator of <receiver>" instruction.
      host._jobSource = job.source;
      host._jobSourceLabel = job.source_label;
      host._jobSourcePin = job.source_pin_sha256;
      follow(job.job_id);
    };
    start().catch((err: unknown) => {
      host._compileReject = null;
      // Raw rejection: compileFailureDetail normalizes downstream.
      reject(err);
    });
  });
}
