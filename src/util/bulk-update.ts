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

/**
 * Bulk-install firmware to *configurations*, surfacing start/error toasts.
 * No-op (info toast) on an empty list. A NO_COMPATIBLE_PEER failure is
 * classified into the offline/version/mixed bucket; everything else gets
 * the generic error toast.
 */
export async function runBulkUpdate(
  configurations: string[],
  ctx: BulkUpdateContext
): Promise<void> {
  if (configurations.length === 0) {
    notifyInfo(ctx.localize("layout.update_all_none"));
    return;
  }
  notifyInfo(ctx.localize("layout.update_all_started", { count: configurations.length }));
  try {
    await ctx.api.firmwareInstallBulk(configurations);
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
      notifyError(ctx.localize("layout.update_all_error"));
    }
  }
}
