/** Usage lookups shared by the packages list and the file editor. */
import { apiErrorDetails } from "../../api/api-error.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { FileUsage } from "../../api/types/files.js";
import type { LocalizeFunc } from "../../common/localize.js";
import {
  LONG_TOAST_DURATION_MS,
  notifyError,
  notifySuccess,
  notifyWarning,
} from "../../util/notify.js";
import type { ESPHomeFileListDialog } from "./file-list-dialog.js";
import { deviceItems, fileItems } from "./link-list.js";
import type { RenameFileDetail } from "./rename-file-dialog.js";

/** Error toast for *key*, with the backend's detail appended when there is one. */
export function notifyFailure(localize: LocalizeFunc, key: string, err: unknown): void {
  const detail = apiErrorDetails(err);
  const base = localize(key);
  notifyError(detail ? `${base}: ${detail}` : base);
}

/** Fetch the devices using *path* and list them in *dialog*. */
export async function showUsage(
  api: ESPHomeAPI,
  localize: LocalizeFunc,
  devices: readonly ConfiguredDevice[],
  dialog: ESPHomeFileListDialog | undefined,
  path: string
): Promise<void> {
  try {
    const usage = await api.getFileUsage(path);
    dialog?.open({
      heading: localize("packages.usage_title", { path }),
      message:
        usage.used_by.length > 0
          ? localize("packages.usage_message", { count: usage.used_by.length })
          : usage.unknown.length === 0
            ? localize("packages.usage_none")
            : "",
      items: deviceItems(usage.used_by, devices),
      note:
        usage.unknown.length > 0
          ? localize("packages.usage_unknown", { names: usage.unknown.join(", ") })
          : undefined,
    });
  } catch (err) {
    notifyFailure(localize, "packages.usage_failed", err);
  }
}

/** Fetch the files *configuration* pulls in and list them in *dialog*. */
export async function showDependencies(
  api: ESPHomeAPI,
  localize: LocalizeFunc,
  devices: readonly ConfiguredDevice[],
  dialog: ESPHomeFileListDialog | undefined,
  configuration: string
): Promise<void> {
  try {
    const deps = await api.getDeviceDependencies(configuration);
    dialog?.open({
      heading: localize("packages.dependencies_title", { name: configuration }),
      message: localize(
        deps.files.length > 0
          ? "packages.dependencies_message"
          : "packages.dependencies_none",
        { count: deps.files.length }
      ),
      items: fileItems(deps.files, devices),
      note: deps.complete ? undefined : localize("packages.dependencies_incomplete"),
    });
  } catch (err) {
    notifyFailure(localize, "packages.dependencies_failed", err);
  }
}

/** Usage of *path* for a rename/delete prompt; null (after a toast) on failure. */
export async function fetchUsers(
  api: ESPHomeAPI,
  localize: LocalizeFunc,
  path: string
): Promise<FileUsage | null> {
  try {
    return await api.getFileUsage(path);
  } catch (err) {
    notifyFailure(localize, "packages.usage_failed", err);
    return null;
  }
}

/** Rename through the backend and report what was rewritten; the new path, or null on failure. */
export async function renameFile(
  api: ESPHomeAPI,
  localize: LocalizeFunc,
  { path, newPath }: RenameFileDetail
): Promise<string | null> {
  let result;
  try {
    result = await api.renameFile(path, newPath);
  } catch (err) {
    notifyFailure(localize, "packages.rename_failed", err);
    return null;
  }
  notifySuccess(localize("packages.renamed", { path: result.path }), {
    description:
      result.rewritten.length > 0
        ? localize("packages.renamed_rewritten", {
            count: result.rewritten.length,
            files: result.rewritten.join(", "),
          })
        : undefined,
  });
  if (result.unresolved.length > 0) {
    notifyWarning(
      localize("packages.renamed_unresolved", { names: result.unresolved.join(", ") }),
      { duration: LONG_TOAST_DURATION_MS }
    );
  }
  return result.path;
}
