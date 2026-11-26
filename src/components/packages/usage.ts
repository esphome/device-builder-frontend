/** Backend calls with toasts, shared by the packages list and the file editor. */
import { apiErrorDetails } from "../../api/api-error.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { LocalizeFunc } from "../../common/localize.js";
import {
  LONG_TOAST_DURATION_MS,
  notifyError,
  notifySuccess,
  notifyWarning,
} from "../../util/notify.js";
import type { RenameFileDetail } from "./rename-file-dialog.js";

/** Error toast for *key*, with the backend's detail appended when there is one. */
export function notifyFailure(localize: LocalizeFunc, key: string, err: unknown): void {
  const detail = apiErrorDetails(err);
  const base = localize(key);
  notifyError(detail ? `${base}: ${detail}` : base);
}

/** Rename through the backend and report what was rewritten; the new path, or null on failure. */
export async function renameFile(
  api: ESPHomeAPI,
  localize: LocalizeFunc,
  { path, newPath, skip }: RenameFileDetail
): Promise<string | null> {
  let result;
  try {
    result = await api.renameFile(path, newPath, skip);
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
