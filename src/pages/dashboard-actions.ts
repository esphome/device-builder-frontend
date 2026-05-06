import toast from "sonner-js";
import type { ESPHomeAPI } from "../api/index.js";
import type {
  ArchivedDevice,
  BulkActionResult,
  ConfiguredDevice,
} from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { withBase } from "../util/base-path.js";

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
  const decoder = new TextDecoderStream();
  port.readable.pipeTo(decoder.writable).catch(() => {
    /* Pipe rejection happens when the reader is cancelled below;
       swallow it so the unhandled promise rejection doesn't bubble
       up into the console. */
  });
  const reader = decoder.readable.getReader();
  let buffer = "";
  let cancelled = false;
  const readLoop = async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (cancelled) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          dialog._lines = [...dialog._lines, line];
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

