import type { ESPHomeAPI } from "../api/index.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import type { LocalizeFunc } from "../common/localize.js";
import type {
  BoardReselectOpenOptions,
  ESPHomeBoardReselectDialog,
} from "../components/device/board-reselect-dialog.js";
import { fetchBoard } from "./board-body-cache.js";
import { notifyError, notifySuccess, notifyWarning } from "./notify.js";
import { boardDisagreesWithYaml, readPlatformBoard } from "./yaml-board.js";

/** Open the reselect picker; a missing dialog is a bug, not "nothing to
 *  offer" — log it loudly and fail open. */
export function openBoardReselect(
  dialog: ESPHomeBoardReselectDialog | undefined,
  opts: BoardReselectOpenOptions
): Promise<boolean> {
  if (!dialog) {
    console.error("Board reselect dialog missing");
    return Promise.resolve(false);
  }
  return dialog.open(opts);
}

/**
 * The device's YAML when it names a different chip than its stored
 * board, else null — callers hand the fetched YAML to the reselect
 * picker to spare a refetch.
 *
 * A fetch failure fails open (null) so install is never blocked on it,
 * but toasts a warning so a persistent failure is distinguishable from
 * a genuine "agrees".
 */
export async function findBoardDisagreement(
  api: ESPHomeAPI,
  localize: LocalizeFunc,
  device: Pick<ConfiguredDevice, "configuration" | "board_id">
): Promise<string | null> {
  if (!device.board_id) return null;
  try {
    const [board, yaml] = await Promise.all([
      fetchBoard(api, device.board_id),
      api.getConfig(device.configuration),
    ]);
    if (!board) return null;
    const parsed = readPlatformBoard(yaml);
    return parsed !== null && boardDisagreesWithYaml(parsed, board) ? yaml : null;
  } catch (err) {
    console.warn("Board disagreement check failed:", err);
    notifyWarning(localize("device.board_check_failed"));
    return null;
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
