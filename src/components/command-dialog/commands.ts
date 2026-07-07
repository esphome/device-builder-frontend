import { APIError } from "../../api/api-error.js";
import { type FirmwareJob, JobStatus, JobType } from "../../api/types/firmware-jobs.js";
import { ErrorCode } from "../../api/types/protocol.js";
import { isTerminalJobStatus } from "../../util/firmware-job-status.js";
import { isValidationFailureLine } from "../../util/validation-log.js";
import { classifyNoCompatiblePeerReason } from "../../util/version-mismatch.js";
import type { CommandType, ESPHomeCommandDialog } from "../command-dialog.js";

const JOB_TYPE_TO_COMMAND: Record<JobType, CommandType> = {
  [JobType.COMPILE]: "compile",
  [JobType.INSTALL]: "install",
  [JobType.UPLOAD]: "install",
  [JobType.CLEAN]: "clean",
  [JobType.RESET_BUILD_ENV]: "reset",
  [JobType.RENAME]: "rename",
};

// A live COMPILE with a held dependent is a chain head — attach in the
// chain's command mode so success reflects the flash, not just the build.
// Terminal reattach keeps plain compile mode: it's a log-review path and
// must show the log the user clicked, not chain into the flash log.
export function deriveFollowCommandType(
  jobs: Map<string, FirmwareJob>,
  job: FirmwareJob
): CommandType {
  if (job.job_type === JobType.COMPILE && !isTerminalJobStatus(job.status)) {
    const dependent = [...jobs.values()].find((j) => j.depends_on === job.job_id);
    if (dependent?.job_type === JobType.RENAME) return "rename";
    if (dependent?.job_type === JobType.UPLOAD) return "install";
  }
  return JOB_TYPE_TO_COMMAND[job.job_type] ?? "install";
}

// An install chain is followed via its COMPILE head, but the flash target
// lives on the dependent UPLOAD — restoring port/bootloader off the head
// reads empty/false and a later "Build locally instead" resubmit flashes
// the app at the default address.
export function findDependentUpload(
  jobs: Map<string, FirmwareJob>,
  job: FirmwareJob
): FirmwareJob | undefined {
  if (job.job_type !== JobType.COMPILE) return undefined;
  for (const j of jobs.values()) {
    if (j.depends_on === job.job_id && j.job_type === JobType.UPLOAD) return j;
  }
  return undefined;
}

export async function detachStream(host: ESPHomeCommandDialog): Promise<void> {
  if (!host._streamId) return;
  const streamId = host._streamId;
  host._streamId = "";
  // Flush the rAF batch so teardowns that keep the buffer visible
  // (close, hand-off, force-local) paint every line that arrived.
  // Restart paths follow up with ``_resetPendingLines``.
  host._flushPendingLines();
  try {
    await host._api.stopStream(streamId);
  } catch {
    /* a stop that fails because the stream already finished is the common case */
  }
}

// Reset the per-run state a fresh attach starts from: the output buffer,
// status banner, and the failure flags that gate the reset/validation hints.
// Shared by every entry point that reuses the singleton dialog for a new run.
export function resetRunState(host: ESPHomeCommandDialog): void {
  host._state = "running";
  host._lines = [];
  host._resetPendingLines();
  host._statusMessage = "";
  host._userStopped = false;
  host._failedDuringValidate = false;
  host._compileMissingDependent = false;
}

export async function startCommand(host: ESPHomeCommandDialog): Promise<void> {
  await detachStream(host);
  host._jobId = "";
  resetRunState(host);
  // Clear primed snapshots so a Retry that picks a different source can't
  // leak the prior job's REMOTE label into renderBuildFailureSuggestion
  // before the new _jobs context update lands. open() already clears these
  // on a fresh dialog; startCommand is the Retry path.
  host._jobStatus = null;
  host._primedSource = null;

  if (host._commandType === "validate") {
    startValidateStream(host);
    return;
  }
  await startFirmwareJob(host);
}

// Validate uses the per-connection streaming command (not a queued job).
export function startValidateStream(host: ESPHomeCommandDialog): void {
  host._streamId = host._api.validate(
    host.configuration,
    {
      onOutput: (line) => {
        host._enqueueLine(line);
        if (isValidationFailureLine(line)) host._failedDuringValidate = true;
      },
      onResult: (data) => {
        host._streamId = "";
        host._flushPendingLines();
        host._state = data.success ? "success" : "error";
        host._statusMessage = host._localize(
          data.success ? "command.validate_success" : "command.validate_failed"
        );
      },
      onError: (error) => {
        host._streamId = "";
        host._flushPendingLines();
        host._state = "error";
        host._statusMessage = error;
      },
    },
    { showSecrets: host._showSecrets }
  );
}

// --show-secrets is baked into the subprocess at spawn time — toggling has
// to tear down + restart. Serialised via _restartInflight so a fast double-
// toggle can't race two restarts (detachStream clears _streamId
// synchronously, so without the guard a second click during the awaited stop
// proceeds with a no-op detach + spawn, then the original await resumes and
// spawns another stream).
export async function toggleShowSecrets(host: ESPHomeCommandDialog): Promise<void> {
  host._showSecrets = !host._showSecrets;
  if (host._commandType !== "validate") return;
  if (host._restartInflight) return;
  host._restartInflight = true;
  try {
    await detachStream(host);
    host._lines = [];
    host._resetPendingLines();
    host._state = "running";
    host._statusMessage = "";
    host._resetAnsiLogScroll();
    startValidateStream(host);
  } finally {
    host._restartInflight = false;
  }
}

// Queue a firmware job, then follow its output via follow_job.
export async function startFirmwareJob(host: ESPHomeCommandDialog): Promise<void> {
  let job: FirmwareJob;
  try {
    switch (host._commandType) {
      case "install":
        job = await host._api.firmwareInstall(
          host.configuration,
          host._port,
          false,
          host._bootloader
        );
        break;
      case "compile":
        job = await host._api.firmwareCompile(host.configuration);
        break;
      case "clean":
        job = await host._api.firmwareClean(host.configuration);
        break;
      default:
        return;
    }
  } catch (err) {
    host._state = "error";
    host._statusMessage = _installErrorMessage(host, err);
    return;
  }

  primeAndFollow(host, job);
}

// Prime status + source so the overlay paints on the first frame, then follow.
// Leaves _commandType to the caller (the install chain relies on it).
function primeAndFollow(host: ESPHomeCommandDialog, job: FirmwareJob): void {
  host._jobId = job.job_id;
  host._jobStatus = job.status;
  host._primedSource = {
    source: job.source,
    source_label: job.source_label,
    source_esphome_version: job.source_esphome_version,
  };
  followJob(host, job.job_id);
}

export function followJob(host: ESPHomeCommandDialog, jobId: string): void {
  // Snapshot whether this attach saw the job live. Reattaching to a
  // terminal job is a review path: yanking the user to logs after they
  // opened firmware-tasks for past output is the surprise behaviour.
  const wasLiveAtAttach = !isTerminalJobStatus(host._jobStatus);
  host._streamId = host._api.firmwareFollowJob(jobId, {
    onOutput: (line) => {
      host._enqueueLine(line);
      if (isValidationFailureLine(line)) host._failedDuringValidate = true;
    },
    onResult: (data) => {
      host._streamId = "";
      host._flushPendingLines();
      const result = data as unknown as Pick<
        FirmwareJob,
        "status" | "exit_code" | "is_deferred_install"
      >;
      const success = result.status === JobStatus.COMPLETED;

      // On a successful install/rename COMPILE, follow the dependent flash —
      // the install's UPLOAD or the rename's flash-and-swap tail — so success
      // reflects the device, not just the build (#1131). Gate on the finished
      // job being the COMPILE so the flash's own completion falls through.
      const finished = host._jobs.get(jobId);
      if (
        success &&
        (host._commandType === "install" || host._commandType === "rename") &&
        finished?.job_type === JobType.COMPILE
      ) {
        // The held dependent is created with the chain; its job_queued is
        // ordered ahead of this compile's job_completed on the shared WS, so it
        // is normally already in _jobs. A miss is therefore a real backend gap.
        const flash = [...host._jobs.values()].find(
          (j) =>
            j.depends_on === jobId &&
            (j.job_type === JobType.UPLOAD || j.job_type === JobType.RENAME)
        );
        if (flash) {
          // primeAndFollow re-primes the source snapshot from the flash (local)
          // so the remote-builder sub-line doesn't linger on the compile's
          // receiver.
          primeAndFollow(host, flash);
          return;
        }
        // A deferred install compiles now and flashes when the device wakes,
        // so no dependent flash exists — queued is the success state.
        if (result.is_deferred_install) {
          host._state = "success";
          host._statusMessage = host._localize("dashboard.queued_successfully");
          host._jobId = "";
          return;
        }
        // No flash step — the device was never flashed, so don't report success.
        console.warn("compile succeeded but no dependent flash for job", jobId);
        host._state = "error";
        host._statusMessage = host._localize(`command.${host._commandType}_failed`);
        // The compile succeeded, so the clean/reset build-failure hint is
        // misleading here — suppress it.
        host._compileMissingDependent = true;
        host._jobId = "";
        return;
      }

      host._state = success ? "success" : "error";
      host._statusMessage = host._localize(
        success
          ? `command.${host._commandType}_success`
          : `command.${host._commandType}_failed`
      );
      host._jobId = "";
      if (
        success &&
        wasLiveAtAttach &&
        host._commandType === "install" &&
        host._showLogsAfterInstall
      ) {
        host._flipToLogs();
      }
    },
    onError: (error) => {
      host._streamId = "";
      host._flushPendingLines();
      host._state = "error";
      host._statusMessage = error;
      host._jobId = "";
    },
  });
}

export function stopCommand(host: ESPHomeCommandDialog): void {
  if (host._state !== "running") return;
  if (host._jobId) host._api.firmwareCancel(host._jobId).catch(() => {});
  host._state = "error";
  host._userStopped = true;
  host._statusMessage = host._localize("command.stopped");
  void detachStream(host);
  host._jobId = "";
}

// Cancel-already-terminal race: backend rejects with NOT_FOUND (job already
// cleared) or INVALID_ARGS ("Cannot cancel a {status} job"). Anything else is
// re-raised so we don't queue a second install while the original keeps running.
function isCancelAlreadyTerminal(err: unknown): boolean {
  if (!(err instanceof APIError)) return false;
  return (
    err.errorCode === ErrorCode.NOT_FOUND || err.errorCode === ErrorCode.INVALID_ARGS
  );
}

function formatForceLocalError(err: unknown): string {
  if (err instanceof APIError) return err.details || err.errorCode;
  if (err instanceof Error) return err.message;
  return String(err);
}

function _installErrorMessage(host: ESPHomeCommandDialog, err: unknown): string {
  if (
    err instanceof APIError &&
    err.errorCode === ErrorCode.NO_COMPATIBLE_PEER &&
    host._appVersion
  ) {
    // ``_appVersion`` empty during a reconnect race would leak ``""``
    // into the ``{local}`` placeholder and misattribute the bucket;
    // fall through to the raw backend message until the version
    // snapshot lands.
    const reason = classifyNoCompatiblePeerReason(
      host._pairings?.values() ?? [],
      host._appVersion
    );
    return host._localize(`command.install_no_compatible_peer_${reason}`, {
      local: host._appVersion,
    });
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

// Cancel the in-flight REMOTE install and resubmit as LOCAL. Dialog stays
// attached: followJob on the new id re-primes _primedSource so the sub-line
// disappears on the very first paint.
export async function onForceLocalClick(host: ESPHomeCommandDialog): Promise<void> {
  if (host._switchingToLocal) return;
  host._switchingToLocal = true;
  const configuration = host.configuration;
  const port = host._port;
  const cancelJobId = host._jobId;
  try {
    if (cancelJobId) {
      try {
        await host._api.firmwareCancel(cancelJobId);
      } catch (cancelErr) {
        if (!isCancelAlreadyTerminal(cancelErr)) throw cancelErr;
      }
    }
    const job = await host._api.firmwareInstall(
      configuration,
      port,
      true,
      host._bootloader
    );
    // Keep _commandType "install": the public followJob would derive "compile"
    // from the returned COMPILE (#1131) and skip the chain. Clear the cancelled
    // attempt and reset the run state (the public followJob did this), then
    // re-attach via primeAndFollow.
    await detachStream(host);
    resetRunState(host);
    primeAndFollow(host, job);
  } catch (err) {
    host._state = "error";
    host._statusMessage = host._localize("command.force_local_failed");
    const detail = formatForceLocalError(err);
    if (detail) {
      host._flushPendingLines();
      host._lines = [...host._lines, detail];
    }
  } finally {
    host._switchingToLocal = false;
  }
}
