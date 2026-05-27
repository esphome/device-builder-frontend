import { APIError } from "../../api/api-error.js";
import { ErrorCode, JobStatus, type FirmwareJob } from "../../api/types.js";
import { isTerminalJobStatus } from "../../util/firmware-job-status.js";
import type { ESPHomeCommandDialog } from "../command-dialog.js";

// Dashboard mode pins escaped form (\033[…m); raw form (\x1b[…m) is defensive.
const ANSI_SGR = /(?:\\033|\x1b)\[[0-9;]*m/g;
// Anchored ERROR prefix so a debug line that quotes the phrase can't match.
// Log format is "<asctime>? <LEVEL> <message>" (esphome/log.py).
const LOADER_ERROR = /^(?:\d{2}:\d{2}:\d{2}\s+)?ERROR Error while reading config:/;

// Two distinct ESPHome validation-failure markers:
//   "Failed config" — schema-validator banner from esphome/config.py
//   "ERROR Error while reading config: …" — YAML-load step _LOGGER.error
// Both indicate the build never reached C++ compile; clean/reset can't help.
export function isValidationFailureLine(line: string): boolean {
  const stripped = line.replace(ANSI_SGR, "").trim();
  if (stripped === "Failed config") return true;
  return LOADER_ERROR.test(stripped);
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

export async function startCommand(host: ESPHomeCommandDialog): Promise<void> {
  await detachStream(host);
  host._jobId = "";
  host._state = "running";
  host._lines = [];
  host._resetPendingLines();
  host._statusMessage = "";
  host._userStopped = false;
  host._failedDuringValidate = false;
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
        job = await host._api.firmwareInstall(host.configuration, host._port);
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
    host._statusMessage = err instanceof Error ? err.message : String(err);
    return;
  }

  host._jobId = job.job_id;
  // Prime from the API response so the queued overlay shows immediately;
  // the matching job_queued event lands in firmwareJobsContext shortly after
  // and the getter prefers that live value going forward.
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
      const result = data as unknown as { status: string; exit_code: number | null };
      const success = result.status === JobStatus.COMPLETED;
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
    const job = await host._api.firmwareInstall(configuration, port, true);
    host.followJob(job, host.name);
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
