import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock("../../src/util/board-body-cache.js", () => ({ fetchBoard: vi.fn() }));

import toast from "sonner-js";
import { makeSlimBoard } from "../_make-slim-board.js";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { BoardCatalogEntry } from "../../src/api/types/boards.js";
import { fetchBoard } from "../../src/util/board-body-cache.js";
import { findBoardDisagreement } from "../../src/util/board-change.js";

// Inline stub: this suite runs in node, and test/_dom.ts drags in Lit's
// DOM helpers.
const identityLocalize = (key: string) => key;

const S3_BOARD = makeSlimBoard("generic-esp32s3", {
  board: "esp32-s3-devkitc-1",
  variant: "esp32s3",
}) as BoardCatalogEntry;
const C3_BOARD = makeSlimBoard("generic-esp32c3", {
  board: "esp32-c3-devkitm-1",
  variant: "esp32c3",
}) as BoardCatalogEntry;
const C3_SIBLING = makeSlimBoard("lolin-c3-mini", {
  board: "lolin_c3_mini",
  variant: "esp32c3",
});

const DEVICE = { configuration: "dev.yaml", board_id: "generic-esp32s3" };

describe("findBoardDisagreement", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("is false without a stored board id", async () => {
    const api = { getConfig: vi.fn() } as unknown as ESPHomeAPI;
    expect(
      await findBoardDisagreement(api, identityLocalize, {
        configuration: "dev.yaml",
        board_id: "",
      })
    ).toBeNull();
    expect(api.getConfig).not.toHaveBeenCalled();
  });

  it("returns the fetched YAML when it names a different chip", async () => {
    // Callers hand this to the reselect picker to spare a refetch.
    vi.mocked(fetchBoard).mockResolvedValue(S3_BOARD);
    const api = {
      getConfig: vi.fn().mockResolvedValue("esp32:\n  variant: esp32c3\n"),
    } as unknown as ESPHomeAPI;
    expect(await findBoardDisagreement(api, identityLocalize, DEVICE)).toBe(
      "esp32:\n  variant: esp32c3\n"
    );
  });

  it("is null when the YAML agrees", async () => {
    vi.mocked(fetchBoard).mockResolvedValue(S3_BOARD);
    const api = {
      getConfig: vi.fn().mockResolvedValue("esp32:\n  board: esp32-s3-devkitc-1\n"),
    } as unknown as ESPHomeAPI;
    expect(await findBoardDisagreement(api, identityLocalize, DEVICE)).toBeNull();
  });

  it("flags a platform mismatch without a catalog lookup", async () => {
    vi.mocked(fetchBoard).mockResolvedValue(S3_BOARD);
    const api = {
      getConfig: vi.fn().mockResolvedValue("esp8266:\n  board: esp01_1m\n"),
      getBoards: vi.fn(),
    } as unknown as ESPHomeAPI;
    expect(await findBoardDisagreement(api, identityLocalize, DEVICE)).toBe(
      "esp8266:\n  board: esp01_1m\n"
    );
    expect(api.getBoards).not.toHaveBeenCalled();
  });

  it("is null for an uncatalogued board string on the same chip", async () => {
    // No pick could ever satisfy a string test here — a flag would
    // re-open the picker on every install, permanently blocking it.
    vi.mocked(fetchBoard).mockResolvedValue(C3_BOARD);
    const api = {
      getConfig: vi
        .fn()
        .mockResolvedValue("esp32:\n  board: vendor-c3\n  variant: esp32c3\n"),
      getBoards: vi.fn().mockResolvedValue({ boards: [] }),
    } as unknown as ESPHomeAPI;
    expect(
      await findBoardDisagreement(api, identityLocalize, {
        configuration: "dev.yaml",
        board_id: "generic-esp32c3",
      })
    ).toBeNull();
  });

  it("is null for an uncatalogued board string with no variant", async () => {
    vi.mocked(fetchBoard).mockResolvedValue(C3_BOARD);
    const api = {
      getConfig: vi.fn().mockResolvedValue("esp32:\n  board: vendor-mystery\n"),
      getBoards: vi.fn().mockResolvedValue({ boards: [] }),
    } as unknown as ESPHomeAPI;
    expect(
      await findBoardDisagreement(api, identityLocalize, {
        configuration: "dev.yaml",
        board_id: "generic-esp32c3",
      })
    ).toBeNull();
  });

  it("flags an uncatalogued board string beside a differing variant", async () => {
    vi.mocked(fetchBoard).mockResolvedValue(S3_BOARD);
    const api = {
      getConfig: vi
        .fn()
        .mockResolvedValue("esp32:\n  board: vendor-c3\n  variant: esp32c3\n"),
      getBoards: vi.fn().mockResolvedValue({ boards: [] }),
    } as unknown as ESPHomeAPI;
    expect(await findBoardDisagreement(api, identityLocalize, DEVICE)).toBe(
      "esp32:\n  board: vendor-c3\n  variant: esp32c3\n"
    );
  });

  it("is null when a resolved board string names the stored chip", async () => {
    vi.mocked(fetchBoard).mockResolvedValue(C3_BOARD);
    const api = {
      getConfig: vi.fn().mockResolvedValue("esp32:\n  board: lolin_c3_mini\n"),
      getBoards: vi.fn().mockResolvedValue({ boards: [C3_SIBLING] }),
    } as unknown as ESPHomeAPI;
    expect(
      await findBoardDisagreement(api, identityLocalize, {
        configuration: "dev.yaml",
        board_id: "generic-esp32c3",
      })
    ).toBeNull();
  });

  it("flags a resolved board string naming a different chip", async () => {
    // The resolved string beats a stale explicit variant beside it.
    vi.mocked(fetchBoard).mockResolvedValue(S3_BOARD);
    const api = {
      getConfig: vi
        .fn()
        .mockResolvedValue("esp32:\n  board: lolin_c3_mini\n  variant: esp32s3\n"),
      getBoards: vi.fn().mockResolvedValue({ boards: [C3_SIBLING] }),
    } as unknown as ESPHomeAPI;
    expect(await findBoardDisagreement(api, identityLocalize, DEVICE)).toBe(
      "esp32:\n  board: lolin_c3_mini\n  variant: esp32s3\n"
    );
  });

  it("fails open with a warning toast on a fetch failure", async () => {
    // Fail open so install is never blocked on a backend blip, but keep
    // a persistent failure distinguishable from a genuine "agrees".
    vi.mocked(fetchBoard).mockResolvedValue(S3_BOARD);
    const api = {
      getConfig: vi.fn().mockRejectedValue(new Error("boom")),
    } as unknown as ESPHomeAPI;
    expect(await findBoardDisagreement(api, identityLocalize, DEVICE)).toBeNull();
    expect(toast.warning).toHaveBeenCalled();
  });
});
