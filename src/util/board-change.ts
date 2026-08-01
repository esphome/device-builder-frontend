import type { ESPHomeAPI } from "../api/index.js";
import type { SlimBoard } from "../api/types/boards.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import type { LocalizeFunc } from "../common/localize.js";
import type {
  BoardReselectOpenOptions,
  ESPHomeBoardReselectDialog,
} from "../components/device/board-reselect-dialog.js";
import { fetchBoard } from "./board-body-cache.js";
import { canonicalComponentKey } from "./component-presence.js";
import { KeyedPromiseCache } from "./keyed-promise-cache.js";
import { notifyError, notifySuccess, notifyWarning } from "./notify.js";
import {
  boardChipToken,
  platformDisagrees,
  readPlatformBoard,
  variantDisagrees,
  type YamlPlatformBoard,
} from "./yaml-board.js";

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

// The catalog is immutable per session, so misses memoise too. Keyed
// on the api instance so a reconnect (or a test's fresh mock) starts
// with an empty cache.
const _matchCaches = new WeakMap<ESPHomeAPI, KeyedPromiseCache<SlimBoard | undefined>>();

/** The catalog board whose PlatformIO string and platform match, memoised per session. */
export function matchCatalogBoard(
  api: ESPHomeAPI,
  board: string,
  platform: string
): Promise<SlimBoard | undefined> {
  let cache = _matchCaches.get(api);
  if (!cache) {
    cache = new KeyedPromiseCache();
    _matchCaches.set(api, cache);
  }
  const target = board.toLowerCase();
  return cache.fetch(`${platform}\n${target}`, async () => {
    const { boards } = await api.getBoards({ query: board, limit: 100 });
    return boards.find(
      (b) =>
        b.esphome.board.toLowerCase() === target &&
        canonicalComponentKey(b.esphome.platform) === platform
    );
  });
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
    if (parsed === null) return null;
    return (await chipDisagrees(api, parsed, board)) ? yaml : null;
  } catch (err) {
    console.warn("Board disagreement check failed:", err);
    notifyWarning(localize("device.board_check_failed"));
    return null;
  }
}

/**
 * Whether the YAML pins a different chip than the stored board.
 *
 * The install-gating rule: a board-string mismatch alone never flags,
 * and a resolved board string beats an explicit variant beside it.
 */
export async function chipDisagrees(
  api: ESPHomeAPI,
  parsed: YamlPlatformBoard,
  stored: SlimBoard
): Promise<boolean> {
  if (platformDisagrees(parsed.platform, stored)) return true;
  if (parsed.board?.toLowerCase() === stored.esphome.board.toLowerCase()) return false;
  if (!boardChipToken(stored)) return false;
  const resolved = parsed.board
    ? await matchCatalogBoard(api, parsed.board, parsed.platform)
    : undefined;
  const yamlChip = resolved
    ? (boardChipToken(resolved) ?? parsed.variant)
    : parsed.variant;
  return variantDisagrees(yamlChip, stored);
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
