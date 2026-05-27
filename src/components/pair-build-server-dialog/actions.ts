import { APIError } from "../../api/api-error.js";
import { ErrorCode, type PairingSummary } from "../../api/types.js";
import { parsePortInput } from "../../util/hostname.js";
import type { ESPHomePairBuildServerDialog } from "../pair-build-server-dialog.js";

export function previewErrorMessage(
  host: ESPHomePairBuildServerDialog,
  err: unknown
): string {
  if (err instanceof APIError) {
    if (err.errorCode === ErrorCode.UNAVAILABLE) {
      return host._localize("settings.pair_build_server_preview_unreachable", {
        hostname: host._hostname,
        port: host._port,
      });
    }
    if (err.errorCode === ErrorCode.INVALID_ARGS) {
      return host._localize("settings.pair_build_server_invalid_args", {
        details: err.details,
      });
    }
  }
  return host._localize("settings.pair_build_server_preview_failed");
}

export function requestErrorMessage(
  host: ESPHomePairBuildServerDialog,
  err: unknown
): string {
  if (err instanceof APIError) {
    if (err.errorCode === ErrorCode.PRECONDITION_FAILED) {
      return host._localize("settings.pair_build_server_pin_changed");
    }
    if (err.errorCode === ErrorCode.NO_PAIRING_WINDOW) {
      return host._localize("settings.pair_build_server_no_window");
    }
    if (err.errorCode === ErrorCode.UNAVAILABLE) {
      return host._localize("settings.pair_build_server_request_unreachable", {
        hostname: host._hostname,
        port: host._port,
      });
    }
    if (err.errorCode === ErrorCode.INVALID_ARGS) {
      return host._localize("settings.pair_build_server_invalid_args", {
        details: err.details,
      });
    }
  }
  return host._localize("settings.pair_build_server_request_failed");
}

export async function onPreviewSubmit(host: ESPHomePairBuildServerDialog): Promise<void> {
  if (host._api === undefined || host._busy) return;
  const hostname = host._hostname.trim();
  const port = parsePortInput(host._port);
  if (!hostname || port === null) {
    host._error = host._localize("settings.pair_build_server_input_invalid");
    return;
  }
  host._busy = true;
  host._error = null;
  try {
    const response = await host._api.previewRemoteBuildPair({ hostname, port });
    host._previewedPin = response.pin_sha256;
    host._step = "confirm";
  } catch (err) {
    host._error = previewErrorMessage(host, err);
  } finally {
    host._busy = false;
  }
}

export async function onConfirmSubmit(host: ESPHomePairBuildServerDialog): Promise<void> {
  if (host._api === undefined || host._busy) return;
  const hostname = host._hostname.trim();
  const port = parsePortInput(host._port);
  if (port === null) return;
  const receiverLabel = host._receiverLabel.trim();
  const offloaderLabel = host._offloaderLabel.trim();
  if (!receiverLabel || !offloaderLabel) {
    host._error = host._localize("settings.pair_build_server_label_required");
    return;
  }
  host._busy = true;
  host._error = null;
  try {
    const summary = await host._api.requestRemoteBuildPair({
      hostname,
      port,
      pin_sha256: host._previewedPin,
      receiver_label: receiverLabel,
      offloader_label: offloaderLabel,
    });
    host._step = "sent";
    // Pin the auto-close watch key. summary.pin_sha256 is the stable
    // cryptographic identity the backend's _pairings dict and app-shell's
    // _buildOffloadPairings both key on (4a-o part 6 — pin-keyed state).
    // Resolves to the same row regardless of receiver hostname case or rename.
    host._sentKey = summary.pin_sha256;
    // Backend persists the StoredPairing row but doesn't fire status_changed
    // on create (events only mark flips). Seed via pair-request-sent so the
    // auto-close watcher has a baseline — otherwise the next event lands
    // against an empty slot and "first approval" reads as "rejection".
    host.dispatchEvent(
      new CustomEvent<{ summary: PairingSummary }>("pair-request-sent", {
        detail: { summary },
        bubbles: true,
        composed: true,
      })
    );
  } catch (err) {
    host._error = requestErrorMessage(host, err);
  } finally {
    host._busy = false;
  }
}

// Auto-close on a matching OFFLOADER_PAIR_STATUS_CHANGED reaching the
// offloader pairings map: receiver clicked Accept (status→"approved") or
// reject/unpair (row leaves the map). Either is the operator's "I can stop
// watching" signal — fire a toast event and close.
export function watchPairingApproval(
  host: ESPHomePairBuildServerDialog,
  changed: Map<string, unknown>
): void {
  if (
    host._sentKey === null ||
    host._step !== "sent" ||
    !changed.has("_buildOffloadPairings")
  ) {
    return;
  }
  const row = host._buildOffloadPairings?.get(host._sentKey);
  if (row !== undefined && row.status === "approved") {
    // Read display fields off the row (still present — approved is a value
    // mutation, not a pop). Avoids hard-coding the ${hostname}:${port} parse
    // pattern from the pre-4a-o hostname-keyed map shape.
    host.dispatchEvent(
      new CustomEvent<{ hostname: string; port: number }>("pair-approved", {
        detail: {
          hostname: row.receiver_hostname,
          port: row.receiver_port,
        },
        bubbles: true,
        composed: true,
      })
    );
    host._sentKey = null;
    host.close();
    return;
  }
  if (row === undefined && host._buildOffloadPairings !== null) {
    // Row went away pre-approval — receiver Reject, user Unpair from another
    // tab, OR receiver-side identity rotation triggered "removed". Can't
    // tell which, but user-visible outcome is the same — fire pair-rejected.
    // Source hostname/port from form state (row is gone; fields still hold
    // what the user typed at submit).
    host.dispatchEvent(
      new CustomEvent<{ hostname: string; port: number }>("pair-rejected", {
        detail: {
          hostname: host._hostname.trim(),
          port: Number.parseInt(host._port, 10),
        },
        bubbles: true,
        composed: true,
      })
    );
    host._sentKey = null;
    host.close();
  }
}
