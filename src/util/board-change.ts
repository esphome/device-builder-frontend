import type { ESPHomeAPI } from "../api/index.js";
import type { LocalizeFunc } from "../common/localize.js";
import { notifyError, notifySuccess } from "./notify.js";

/** Write a device's sidecar `board_id` and toast the outcome; true on success. */
export async function applyBoardChange(
  api: ESPHomeAPI,
  localize: LocalizeFunc,
  configuration: string,
  boardId: string
): Promise<boolean> {
  try {
    await api.updateDevice({ configuration, board_id: boardId });
    notifySuccess(localize("device.change_board_success"));
    return true;
  } catch (err) {
    console.error("Failed to change board:", err);
    notifyError(localize("device.change_board_error"));
    return false;
  }
}
