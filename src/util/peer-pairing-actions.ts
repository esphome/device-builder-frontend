import { APIError, apiErrorDetails } from "../api/api-error.js";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import { ErrorCode } from "../api/types/protocol.js";
import type { LocalizeFunc } from "../common/localize.js";
import { notify } from "./notify.js";

/**
 * Approve a pending pairing request, toasting the outcome.
 *
 * ``NOT_FOUND`` (the request was handled elsewhere / expired) toasts the
 * already-gone warning instead of an error.
 */
export async function approvePeerRequest(
  api: ESPHomeAPI,
  localize: LocalizeFunc,
  dashboardId: string
): Promise<void> {
  const prefix = "settings.build_server_peer_approve";
  try {
    await api.approveRemoteBuildPeer({ dashboard_id: dashboardId });
  } catch (err) {
    _toastApiFailure(localize, prefix, err);
    return;
  }
  notify.success(localize(`${prefix}_success`));
}

/** Reject (remove) a pending pairing request, toasting the outcome. */
export async function rejectPeerRequest(
  api: ESPHomeAPI,
  localize: LocalizeFunc,
  dashboardId: string
): Promise<void> {
  const prefix = "settings.build_server_peer_reject";
  try {
    await api.removeRemoteBuildPeer({ dashboard_id: dashboardId });
  } catch (err) {
    _toastApiFailure(localize, prefix, err);
    return;
  }
  notify.success(localize(`${prefix}_success`));
}

function _toastApiFailure(localize: LocalizeFunc, prefix: string, err: unknown): void {
  if (err instanceof APIError && err.errorCode === ErrorCode.NOT_FOUND) {
    notify.warning(localize(`${prefix}_already_gone`));
    return;
  }
  const reason = apiErrorDetails(err);
  if (reason) {
    notify.error(localize(`${prefix}_failed_detail`, { reason }));
    return;
  }
  notify.error(localize(`${prefix}_failed`));
}
