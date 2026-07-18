import type { ESPHomeAPI } from "../api/index.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import type { LocalizeFunc } from "../common/localize.js";
import { fetchBoard } from "./board-body-cache.js";
import { notifyError, notifySuccess, notifyWarning } from "./notify.js";
import { boardDisagreesWithYaml, readPlatformBoard } from "./yaml-board.js";

/**
 * Whether the device's YAML names a different chip than its stored board.
 *
 * Fetches both sides; a fetch failure fails open so install is never
 * blocked on it — but toasts a warning so a persistent failure is
 * distinguishable from a genuine "agrees".
 */
export async function findBoardDisagreement(
  api: ESPHomeAPI,
  localize: LocalizeFunc,
  device: Pick<ConfiguredDevice, "configuration" | "board_id">
): Promise<boolean> {
  if (!device.board_id) return false;
  try {
    const [board, yaml] = await Promise.all([
      fetchBoard(api, device.board_id),
      api.getConfig(device.configuration),
    ]);
    if (!board) return false;
    const parsed = readPlatformBoard(yaml);
    return parsed !== null && boardDisagreesWithYaml(parsed, board);
  } catch (err) {
    console.warn("Board disagreement check failed:", err);
    notifyWarning(localize("device.board_check_failed"));
    return false;
  }
}

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
