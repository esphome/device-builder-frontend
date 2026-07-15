import { APIError, apiErrorDetails } from "../api/api-error.js";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import { ErrorCode } from "../api/types/protocol.js";
import type { LocalizeFunc } from "../common/localize.js";
import { notify } from "./notify.js";

/**
 * Cancel a firmware job, toasting real failures.
 *
 * The already-finished race is silent (``NOT_FOUND`` for a pruned job,
 * ``INVALID_ARGS`` for a terminal one) — follow_jobs reconciles the row.
 */
export async function cancelFirmwareJob(
  api: ESPHomeAPI,
  localize: LocalizeFunc,
  jobId: string
): Promise<void> {
  try {
    await api.firmwareCancel(jobId);
  } catch (err) {
    if (
      err instanceof APIError &&
      (err.errorCode === ErrorCode.NOT_FOUND || err.errorCode === ErrorCode.INVALID_ARGS)
    ) {
      return;
    }
    const reason = apiErrorDetails(err);
    if (reason) {
      notify.error(localize("firmware_jobs.cancel_failed_detail", { reason }));
      return;
    }
    notify.error(localize("firmware_jobs.cancel_failed"));
  }
}
