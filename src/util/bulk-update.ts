import { notifyError, notifyInfo } from "./notify.js";

import { APIError } from "../api/api-error.js";
import type { ESPHomeAPI } from "../api/index.js";
import { ErrorCode } from "../api/types/protocol.js";
import type { PairingSummary } from "../api/types/remote-build.js";
import type { LocalizeFunc } from "../common/localize.js";

import { classifyNoCompatiblePeerReason } from "./version-mismatch.js";

export interface BulkUpdateContext {
  api: ESPHomeAPI;
  localize: LocalizeFunc;
  appVersion: string;
  pairings: Iterable<PairingSummary>;
}

interface BulkAction {
  call: (api: ESPHomeAPI, configurations: string[]) => Promise<unknown>;
  startedKey: string;
  noneKey: string;
  errorKey: string;
}

/** Bulk-install firmware to *configurations* (compile + upload chains). */
export async function runBulkUpdate(
  configurations: string[],
  ctx: BulkUpdateContext
): Promise<void> {
  return runBulkAction(configurations, ctx, {
    call: (api, c) => api.firmwareInstallBulk(c),
    startedKey: "layout.update_all_started",
    noneKey: "layout.update_all_none",
    errorKey: "layout.update_all_error",
  });
}

/** Bulk compile-only for *configurations* — build every firmware, install nothing. */
export async function runBulkCompile(
  configurations: string[],
  ctx: BulkUpdateContext
): Promise<void> {
  return runBulkAction(configurations, ctx, {
    call: (api, c) => api.firmwareCompileBulk(c),
    startedKey: "layout.compile_all_started",
    noneKey: "layout.compile_all_none",
    errorKey: "layout.compile_all_error",
  });
}

/**
 * Run one bulk firmware *action*, surfacing start/error toasts.
 * No-op (info toast) on an empty list. A NO_COMPATIBLE_PEER failure is
 * classified into the offline/version/mixed bucket; everything else gets
 * the action's generic error toast.
 */
async function runBulkAction(
  configurations: string[],
  ctx: BulkUpdateContext,
  action: BulkAction
): Promise<void> {
  if (configurations.length === 0) {
    notifyInfo(ctx.localize(action.noneKey));
    return;
  }
  notifyInfo(ctx.localize(action.startedKey, { count: configurations.length }));
  try {
    await action.call(ctx.api, configurations);
  } catch (err) {
    if (
      err instanceof APIError &&
      err.errorCode === ErrorCode.NO_COMPATIBLE_PEER &&
      ctx.appVersion
    ) {
      // ``appVersion`` empty during a reconnect race would leak into the
      // ``{local}`` placeholder and misattribute the bucket; fall through
      // to the generic toast.
      const reason = classifyNoCompatiblePeerReason(ctx.pairings, ctx.appVersion);
      notifyError(
        ctx.localize(`layout.update_all_no_compatible_peer_${reason}`, {
          local: ctx.appVersion,
        })
      );
    } else {
      notifyError(ctx.localize(action.errorKey));
    }
  }
}
