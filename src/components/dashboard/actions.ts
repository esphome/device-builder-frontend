import toast from "sonner-js";
import type { ESPHomeAPI } from "../../api/index.js";
import type {
  ArchivedDevice,
  BoardCatalogEntry,
  BulkActionResult,
  ConfiguredDevice,
} from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { withBase } from "../../util/base-path.js";
import { downloadBase64Binary } from "../../util/download-text.js";
import {
  connectToPort,
  detectChip,
  disconnect,
  readDeviceManifest,
  readMacAddress,
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
  localize: LocalizeFunc,
): Promise<boolean> {
  const name = device.friendly_name || device.name;
  try {
    await api.archiveDevice(device.configuration);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    toast.error(localize("dashboard.action_archive_failed", { name, error }), {
      richColors: true,
    });
    return false;
  }
  /* The toast carries the discoverability hint for unarchive —
     archive is a one-way action from the user's POV unless we
     tell them where to find the restore path. The Archived
     devices entry lives in the header kebab; spelling it out
     in the success toast saves a "where did my device go?"
     support thread. */
  toast.success(localize("dashboard.action_archive_success", { name }), {
    description: localize("dashboard.action_archive_success_hint"),
    richColors: true,
    duration: 8000,
  });
  return true;
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
  localize: LocalizeFunc,
): Promise<boolean> {
  const name = device.friendly_name || device.name || device.configuration;
  try {
    await api.unarchiveDevice(device.configuration);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    toast.error(
      localize("dashboard.action_unarchive_failed", { name, error }),
      { richColors: true },
    );
    return false;
  }
  toast.success(
    localize("dashboard.action_unarchive_success", { name }),
    { richColors: true },
  );
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
  localize: LocalizeFunc,
): Promise<boolean> {
  const name = device.friendly_name || device.name || device.configuration;
  try {
    await api.deleteArchivedDevice(device.configuration);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    toast.error(
      localize("dashboard.action_delete_archived_failed", { name, error }),
      { richColors: true },
    );
    return false;
  }
  toast.success(
    localize("dashboard.action_delete_archived_success", { name }),
    { richColors: true },
  );
  return true;
}

export function deleteDevice(
  device: ConfiguredDevice,
  api: ESPHomeAPI,
  devices: ConfiguredDevice[],
  localize: LocalizeFunc
) {
  const name = device.friendly_name || device.name;
  toast.success(localize("dashboard.deleted", { name }), { richColors: true });
  api.deleteDevice(device.configuration).catch(() => {
    if (devices.some((d) => d.configuration === device.configuration)) {
      toast.error(localize("dashboard.delete_failed", { name }), { richColors: true });
    }
  });
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
    successOptions?: Parameters<typeof toast.success>[1];
  },
) {
  let results: BulkActionResult[];
  try {
    results = await call(configurations);
  } catch {
    toast.error(localize(copy.catchAllKey), { richColors: true });
    return;
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success);

  if (succeeded > 0) {
    toast.success(
      localize(copy.successKey, { count: succeeded }),
      { richColors: true, ...copy.successOptions },
    );
  }
  // Index by configuration up front so failure-toast naming is
  // O(failures) instead of O(failures × devices) on big selections.
  const devicesByConfiguration = new Map(
    devices.map((d) => [d.configuration, d] as const),
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
    toast.error(
      localize(copy.failureKey, { name, error: result.error || fallbackError }),
      { richColors: true },
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
  localize: LocalizeFunc,
) {
  await runBulkAction(configurations, devices, localize, (c) => api.archiveBulkDevices(c), {
    catchAllKey: "dashboard.archive_bulk_failed",
    successKey: "dashboard.archive_bulk_success",
    failureKey: "dashboard.action_archive_failed",
    successOptions: {
      description: localize("dashboard.action_archive_success_hint"),
      duration: 8000,
    },
  });
}

export async function deleteBulkDevices(
  configurations: string[],
  devices: ConfiguredDevice[],
  api: ESPHomeAPI,
  localize: LocalizeFunc,
) {
  await runBulkAction(configurations, devices, localize, (c) => api.deleteBulkDevices(c), {
    catchAllKey: "dashboard.delete_bulk_failed",
    successKey: "dashboard.delete_bulk_success",
    failureKey: "dashboard.delete_failed",
  });
}

export async function downloadYaml(
  device: ConfiguredDevice,
  api: ESPHomeAPI,
  localize: LocalizeFunc
) {
  const name = device.friendly_name || device.name;
  let url: string | undefined;
  try {
    const yaml = await api.getConfig(device.configuration);
    const blob = new Blob([yaml], { type: "text/yaml" });
    url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = device.configuration.endsWith(".yaml")
      ? device.configuration
      : `${device.configuration}.yaml`;
    a.click();
  } catch {
    toast.error(localize("dashboard.action_download_yaml_failed", { name }), {
      richColors: true,
    });
  } finally {
    if (url) {
      URL.revokeObjectURL(url);
    }
  }
}

export async function downloadFirmware(
  device: ConfiguredDevice,
  api: ESPHomeAPI,
  localize: LocalizeFunc,
): Promise<void> {
  const name = device.friendly_name || device.name;
  try {
    const binaries = await api.firmwareGetBinaries(device.configuration);
    if (binaries.length === 0) {
      toast.error(localize("dashboard.download_no_binaries", { name }), {
        richColors: true,
      });
      return;
    }
    const binary = binaries[0];
    const result = await api.firmwareDownload(device.configuration, binary.file);
    downloadBase64Binary(result.data, result.filename);
  } catch {
    toast.error(localize("dashboard.download_firmware_failed", { name }), {
      richColors: true,
    });
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
  } = {},
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
            (d) => d.mac_address && d.mac_address.toUpperCase() === mac,
          ) ?? null;
      } catch {
        // MAC read failed (unsupported chip family, transport flap);
        // fall through to the wizard.
      }
    }

    // Manifest lookup — runs only when MAC didn't match an existing
    // device. ``readDeviceManifest`` already swallows read / parse
    // failures and returns null, so this can't throw.
    const manifest = recognized
      ? null
      : await readDeviceManifest(detected.loader);

    await disconnect(detected.transport);

    if (recognized && options.onRecognized) {
      if (options.localize) {
        toast.success(
          options.localize("dashboard.serial_recognized", {
            name: recognized.friendly_name || recognized.name,
          }),
          { richColors: true },
        );
      }
      options.onRecognized(recognized);
      return;
    }

    if (manifest?.board_id) {
      const board = await api.getBoard(manifest.board_id);
      if (board) {
        if (options.localize) {
          toast.success(
            options.localize("dashboard.serial_starterkit_detected", {
              name: board.name,
            }),
            { richColors: true },
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
  } catch {
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
 * Returns a cancel function the dialog stores and calls on
 * close / openPassive (to stop a previous session before starting
 * a new one). Without that hook the read loop survived dialog
 * closes and bled output from a previous serial port into the
 * next session — a Copilot find on PR #68.
 *
 * The cancel:
 *   * ``reader.cancel()`` releases the pending ``read()`` so the
 *     loop's ``await`` settles and the loop exits via ``done``.
 *   * ``reader.releaseLock()`` lets the decoder pipeline tear down
 *     cleanly; otherwise a future getReader() call on the same
 *     readable would throw.
 */
export function streamSerialToDialog(port: any, dialog: any): () => void {
  /* Read directly from ``port.readable.getReader()`` and decode in
     userland rather than going through ``port.readable.pipeTo()`` +
     a ``TextDecoderStream``. The pipeTo plumbing has been observed
     to silently swallow bytes on some bridge chips (notably CH9102F)
     after a close/reopen within the same USB session — direct reads
     do not. */
  const reader = port.readable.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let cancelled = false;
  const readLoop = async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done || cancelled) break;
        if (value && value.length) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            /* Strip trailing CR (CRLF endings from the ROM
               bootloader and many serial sources). ``ansi-log``
               treats any chunk ending in ``\r`` as a progress-style
               overwrite — it pops the previous visual line and
               replaces it in place — so a stream of CRLF-terminated
               boot lines would collapse to just the last one. */
            const cleaned = line.endsWith("\r") ? line.slice(0, -1) : line;
            dialog._lines = [...dialog._lines, cleaned];
          }
        }
      }
    } catch {
      /* Port closed or reader cancelled — both are normal exits. */
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* Lock already released — ignore. */
      }
    }
  };
  readLoop();
  return () => {
    if (cancelled) return;
    cancelled = true;
    // Cancel the reader first so its lock is released, then close
    // the port. Without ``port.close()`` the browser keeps the OS
    // handle open: every reopen of the passive logs viewer leaks
    // another open port and eventually trips the per-tab Web Serial
    // ceiling so the user can't reconnect to the same device until
    // they refresh the page.
    reader
      .cancel()
      .catch(() => {
        /* Already disposed — nothing to do. */
      })
      .finally(() => {
        port.close().catch(() => {
          /* Port already closed (user pulled the cable, etc). */
        });
      });
  };
}

