import { APIError, apiErrorDetails } from "../api/api-error.js";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import { ErrorCode } from "../api/types/protocol.js";
import type { LocalizeFunc } from "../common/localize.js";
import { notify } from "./notify.js";

/**
 * Cancel a firmware job, toasting real failures.
 *
 * The already-finished race is silent (``NOT_FOUND`` for a pruned job,
 * the backend's "Cannot cancel a <status> job" rejection for a terminal
 * one) — follow_jobs reconciles the row.
 */
export async function cancelFirmwareJob(
  api: ESPHomeAPI,
  localize: LocalizeFunc,
  jobId: string
): Promise<void> {
  try {
    await api.firmwareCancel(jobId);
  } catch (err) {
    if (err instanceof APIError && _isAlreadyFinished(err)) return;
    const reason = apiErrorDetails(err);
    if (reason) {
      notify.error(localize("firmware_jobs.cancel_failed_detail", { reason }));
      return;
    }
    notify.error(localize("firmware_jobs.cancel_failed"));
  }
}

function _isAlreadyFinished(err: APIError): boolean {
  if (err.errorCode === ErrorCode.NOT_FOUND) return true;
  // The terminal-job rejection rides INVALID_ARGS with this message
  // (backend firmware jobs.cancel); other INVALID_ARGS failures toast.
  return (
    err.errorCode === ErrorCode.INVALID_ARGS &&
    apiErrorDetails(err).startsWith("Cannot cancel a")
  );
}
