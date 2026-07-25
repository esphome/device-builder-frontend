import type { ESPHomeAPI } from "../../api/index.js";
import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { ArchivedDevice, BulkActionResult } from "../../api/types/system.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { withBase } from "../../util/base-path.js";
import { fetchBoard } from "../../util/board-body-cache.js";
import { downloadBlob } from "../../util/download-text.js";
import { getErrorMessage } from "../../util/error-message.js";
import { notifyError, notifySuccess, type NotifyOptions } from "../../util/notify.js";
import { streamSerialLines } from "../../util/serial-log-stream.js";
import {
  connectToPort,
  detectChip,
  disconnect,
  isPortPickerCancel,
  readDeviceManifest,
  readMacAddress,
  UnsupportedChipError,
} from "../../util/web-serial.js";
import { chipNameToFilterLabel } from "../wizard/wizard-step-board-platforms.js";

export function editDevice(device: ConfiguredDevice) {
  window.history.pushState({}, "", withBase(`/device/${device.configuration}`));
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * Soft-delete: backend moves YAML to ``<config_dir>/archive/`` and
 * wipes the per-device build dir. Reversible via ``unarchiveDevice``.
 *
 * The backend fires ``DEVICE_REMOVED`` so the active device list
 * updates via the existing scan event flow. Caller is responsible
 * for refreshing the archived list afterwards (it's not event-driven).
 */
export async function archiveDevice(
  device: ConfiguredDevice,
  api: ESPHomeAPI,
  localize: LocalizeFunc
): Promise<boolean> {
  const name = device.friendly_name || device.name;
  try {
    await api.archiveDevice(device.configuration);
  } catch (err) {
    const error = getErrorMessage(err);
    notifyError(localize("dashboard.action_archive_failed", { name, error }));
    return false;
  }
  /* The toast carries the discoverability hint for unarchive —
     archive is a one-way action from the user's POV unless we
     tell them where to find the restore path. The Archived
     devices entry lives in the header kebab; spelling it out
     in the success toast saves a "where did my device go?"
     support thread. */
  notifySuccess(localize("dashboard.action_archive_success", { name }), {
    description: localize("dashboard.action_archive_success_hint"),
    duration: 8000,
  });
  return true;
}

/** Drop a staged offline update; the clock indicator clears via DEVICE_UPDATED. */
export async function clearQueuedUpdate(
  device: ConfiguredDevice,
  api: ESPHomeAPI,
  localize: LocalizeFunc
): Promise<void> {
  const name = device.friendly_name || device.name;
  try {
    await api.firmwareClearQueuedUpdate(device.configuration);
  } catch (err) {
    const error = getErrorMessage(err);
    notifyError(localize("dashboard.queued_update_clear_failed", { name, error }));
    return;
  }
  notifySuccess(localize("dashboard.queued_update_cleared", { name }));
}

/**
 * Restore an archived YAML back into the active config dir.
 *
 * Backend errors with INVALID_ARGS if an active config with the
 * same filename already exists; surface the server message in the
 * toast so the user can resolve it (delete or rename the active
 * one before retrying).
 *
 * Takes the full ``ArchivedDevice`` (not just the ``configuration``)
 * so toasts can show ``friendly_name`` / ``name`` in the same shape
 * as ``archiveDevice`` and ``deleteArchivedDevice`` instead of
 * showing the raw YAML filename.
 */
export async function unarchiveDevice(
  device: ArchivedDevice,
  api: ESPHomeAPI,
  localize: LocalizeFunc
): Promise<boolean> {
  const name = device.friendly_name || device.name || device.configuration;
  try {
    await api.unarchiveDevice(device.configuration);
  } catch (err) {
    const error = getErrorMessage(err);
    notifyError(localize("dashboard.action_unarchive_failed", { name, error }));
    return false;
  }
  notifySuccess(localize("dashboard.action_unarchive_success", { name }));
  return true;
}

/**
 * Permanently delete an archived YAML and its sidecars. Companion
 * to ``archiveDevice`` for "I really don't want this back" — caller
 * is expected to have already gated this through a confirm dialog
 * since it's irreversible.
 */
export async function deleteArchivedDevice(
  device: ArchivedDevice,
  api: ESPHomeAPI,
  localize: LocalizeFunc
): Promise<boolean> {
  const name = device.friendly_name || device.name || device.configuration;
  try {
    await api.deleteArchivedDevice(device.configuration);
  } catch (err) {
    const error = getErrorMessage(err);
    notifyError(localize("dashboard.action_delete_archived_failed", { name, error }));
    return false;
  }
  notifySuccess(localize("dashboard.action_delete_archived_success", { name }));
  return true;
}

export async function deleteDevice(
  device: ConfiguredDevice,
  api: ESPHomeAPI,
  localize: LocalizeFunc
): Promise<boolean> {
  const name = device.friendly_name || device.name;
  try {
    await api.deleteDevice(device.configuration);
  } catch {
    notifyError(localize("dashboard.delete_failed", { name }));
    return false;
  }
  notifySuccess(localize("dashboard.deleted", { name }));
  return true;
}

/**
 * Shared per-row success/failure toast handler for bulk WS commands
 * (``devices/delete_bulk``, ``devices/archive_bulk``). The backend
 * runs each per-device action independently and returns
 * ``BulkActionResult[]`` — aggregate the per-row outcomes into one
 * success-count toast plus one error toast per failed row, instead
 * of the per-device toasts the single-call paths emit.
 *
 * ``catchAllKey`` is the localize key shown when the bulk command
 * itself rejects (network drop, server-side ``CommandError``) before
 * any per-row results come back.
 */
async function runBulkAction(
  configurations: string[],
  devices: ConfiguredDevice[],
  localize: LocalizeFunc,
  call: (configurations: string[]) => Promise<BulkActionResult[]>,
  copy: {
    catchAllKey: string;
    successKey: string;
    failureKey: string;
    successOptions?: NotifyOptions;
  }
) {
  let results: BulkActionResult[];
  try {
    results = await call(configurations);
  } catch {
    notifyError(localize(copy.catchAllKey));
    return;
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success);

  if (succeeded > 0) {
    notifySuccess(localize(copy.successKey, { count: succeeded }), copy.successOptions);
  }
  // Index by configuration up front so failure-toast naming is
  // O(failures) instead of O(failures × devices) on big selections.
  const devicesByConfiguration = new Map(
    devices.map((d) => [d.configuration, d] as const)
  );
  const fallbackError = localize("dashboard.bulk_failure_unknown_error");
  for (const result of failed) {
    const device = devicesByConfiguration.get(result.configuration);
    const name = device ? device.friendly_name || device.name : result.configuration;
    // Fall back to a localized "Unknown error" string when the
    // backend's per-row result didn't include one — without this
    // the failure toasts read like ``Failed to archive "kitchen": ``
    // (dangling colon) because ``action_archive_failed`` /
    // ``action_unarchive_failed`` interpolate ``{error}`` directly.
    notifyError(
      localize(copy.failureKey, { name, error: result.error || fallbackError })
    );
  }
}

/**
 * Archive several devices at once via the ``devices/archive_bulk``
 * WS command. Per-row results route through ``runBulkAction`` so
 * the toast shape matches ``deleteBulkDevices``.
 */
export async function archiveBulkDevices(
  configurations: string[],
  devices: ConfiguredDevice[],
  api: ESPHomeAPI,
  localize: LocalizeFunc
) {
  await runBulkAction(
    configurations,
    devices,
    localize,
    (c) => api.archiveBulkDevices(c),
    {
      catchAllKey: "dashboard.archive_bulk_failed",
      successKey: "dashboard.archive_bulk_success",
      failureKey: "dashboard.action_archive_failed",
      successOptions: {
        description: localize("dashboard.action_archive_success_hint"),
        duration: 8000,
      },
    }
  );
}

export async function deleteBulkDevices(
  configurations: string[],
  devices: ConfiguredDevice[],
  api: ESPHomeAPI,
  localize: LocalizeFunc
) {
  await runBulkAction(
    configurations,
    devices,
    localize,
    (c) => api.deleteBulkDevices(c),
    {
      catchAllKey: "dashboard.delete_bulk_failed",
      successKey: "dashboard.delete_bulk_success",
      failureKey: "dashboard.delete_failed",
    }
  );
}

export async function downloadYaml(
  device: ConfiguredDevice,
  api: ESPHomeAPI,
  localize: LocalizeFunc
) {
  const name = device.friendly_name || device.name;
  try {
    const yaml = await api.getConfig(device.configuration);
    const filename = device.configuration.endsWith(".yaml")
      ? device.configuration
      : `${device.configuration}.yaml`;
    downloadBlob(yaml, filename, "text/yaml");
  } catch {
    notifyError(localize("dashboard.action_download_yaml_failed", { name }));
  }
}

export async function detectAndOpenWizard(
  api: ESPHomeAPI,
  createDialog: {
    open(step?: string): void;
    openWithBoard(board: BoardCatalogEntry): void;
    openAtBoardStep(filterLabel?: string): void;
  },
  options: {
    /** Port captured from the ``navigator.serial`` ``connect`` event —
     *  when present we skip the browser picker (the user already
     *  granted permission for this port in a prior session). */
    port?: SerialPort | null;
    /** Configured-device list to match the serial-read MAC against.
     *  When a match is found, the caller's ``onRecognized`` runs
     *  instead of the new-device wizard. */
    devices?: ConfiguredDevice[];
    /** Called when the MAC lookup matches an existing
     *  ``ConfiguredDevice``. Caller wires this to "open device
     *  drawer / re-flash flow" — we don't route there ourselves so
     *  this function stays UI-agnostic. */
    onRecognized?: (device: ConfiguredDevice) => void;
    localize?: LocalizeFunc;
  } = {}
): Promise<void> {
  try {
    const detected = options.port
      ? await connectToPort(options.port)
      : await detectChip();
    const chipName = detected.chipName;

    // MAC lookup is best-effort — a failure here shouldn't sink the
    // wizard fallback. Wrap in its own try so we always disconnect.
    let recognized: ConfiguredDevice | null = null;
    if (options.devices?.length && options.onRecognized) {
      try {
        const mac = await readMacAddress(detected.loader);
        recognized =
          options.devices.find(
            (d) => d.mac_address && d.mac_address.toUpperCase() === mac
          ) ?? null;
      } catch {
        // MAC read failed (unsupported chip family, transport flap);
        // fall through to the wizard.
      }
    }

    // Manifest lookup — runs only when MAC didn't match an existing
    // device. ``readDeviceManifest`` already swallows read / parse
    // failures and returns null, so this can't throw.
    const manifest = recognized ? null : await readDeviceManifest(detected.loader);

    await disconnect(detected.transport);

    if (recognized && options.onRecognized) {
      if (options.localize) {
        notifySuccess(
          options.localize("dashboard.serial_recognized", {
            name: recognized.friendly_name || recognized.name,
          })
        );
      }
      options.onRecognized(recognized);
      return;
    }

    if (manifest?.board_id) {
      const board = await fetchBoard(api, manifest.board_id);
      if (board) {
        if (options.localize) {
          notifySuccess(
            options.localize("dashboard.serial_starterkit_detected", {
              name: board.name,
            })
          );
        }
        createDialog.openWithBoard(board);
        return;
      }
      // ``board_id`` in the manifest but the catalog doesn't know it
      // (older dashboard / unreleased product). Fall through to the
      // chip-family picker rather than failing — the user still
      // gets a useful onboarding path.
    }

    createDialog.openAtBoardStep(chipNameToFilterLabel(chipName) ?? undefined);
  } catch (err) {
    // Detection failed (or the picker was cancelled) — the wizard still
    // opens so the user can pick a board by hand, but a real connect
    // failure gets named instead of vanishing (#1414).
    if (!isPortPickerCancel(err) && options.localize) {
      notifyError(
        err instanceof UnsupportedChipError
          ? options.localize("serial.unsupported_chip", { chip: err.chipName })
          : options.localize("dashboard.serial_connect_failed", {
              error: getErrorMessage(err),
            })
      );
    }
    createDialog.open("board");
  }
}

export async function fetchApiKey(
  device: ConfiguredDevice,
  api: ESPHomeAPI
): Promise<string> {
  // Server-side resolution — uses ESPHome's YAML loader so !secret /
  // !include / packages all resolve the same way as a real compile.
  // (Previously named ``extractApiKey`` when this was a regex on the
  // raw YAML; the new name reflects that the work is on the backend.)
  try {
    return await api.getApiKey(device.configuration);
  } catch {
    return "";
  }
}

/**
 * Pipe a Web Serial port into the logs dialog's line buffer.
 *
 * A thin adapter over the shared ``streamSerialLines`` reader (which owns the
 * read loop, ESPHome log formatting, timestamps, and garbage filtering — see
 * ``util/serial-log-stream.ts``); this only routes each finished line to the
 * dialog, honouring the display-only Stop *pause* gate. The reader keeps
 * draining while paused so resuming needn't reopen the port and pulse DTR/RTS,
 * which reboots the device (#526).
 *
 * Returns a cancel the dialog stores and calls on close / openPassive to stop
 * a previous session (without it the loop bled a prior port's output into the
 * next session — a Copilot find on PR #68). The cancel stops the loop AND
 * closes the port; a Stop pause never calls it.
 */
export function streamSerialToDialog(port: any, dialog: any): () => void {
  return streamSerialLines(port, {
    onLine: (line) => {
      // Keep draining while paused (Stop) but don't display (#526).
      if (!dialog._serialPaused) {
        dialog._noteSerialActivity();
        dialog._enqueueLine(line);
      }
    },
  });
}
