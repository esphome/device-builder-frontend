import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock("../../src/util/board-body-cache.js", () => ({ fetchBoard: vi.fn() }));

import toast from "sonner-js";
import { makeSlimBoard } from "../_make-slim-board.js";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { BoardCatalogEntry, SlimBoard } from "../../src/api/types/boards.js";
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
const C3_DEVICE = { configuration: "dev.yaml", board_id: "generic-esp32c3" };

const makeApi = (yaml: string | Error, boards: SlimBoard[] = []) =>
  ({
    getConfig:
      yaml instanceof Error
        ? vi.fn().mockRejectedValue(yaml)
        : vi.fn().mockResolvedValue(yaml),
    getBoards: vi.fn().mockResolvedValue({ boards }),
  }) as unknown as ESPHomeAPI;

describe("findBoardDisagreement", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("is false without a stored board id", async () => {
    const api = makeApi("");
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
    const yaml = "esp32:\n  variant: esp32c3\n";
    expect(await findBoardDisagreement(makeApi(yaml), identityLocalize, DEVICE)).toBe(
      yaml
    );
  });

  it("is null when the YAML agrees", async () => {
    vi.mocked(fetchBoard).mockResolvedValue(S3_BOARD);
    const yaml = "esp32:\n  board: esp32-s3-devkitc-1\n";
    expect(
      await findBoardDisagreement(makeApi(yaml), identityLocalize, DEVICE)
    ).toBeNull();
  });

  it("is null when the board string matches despite a contradicting variant", async () => {
    // Every same-string pick shares the chip, so flagging would loop;
    // the compile surfaces the YAML's own contradiction.
    vi.mocked(fetchBoard).mockResolvedValue(S3_BOARD);
    const yaml = "esp32:\n  board: esp32-s3-devkitc-1\n  variant: esp32c3\n";
    const api = makeApi(yaml);
    expect(await findBoardDisagreement(api, identityLocalize, DEVICE)).toBeNull();
    expect(api.getBoards).not.toHaveBeenCalled();
  });

  it("flags a platform mismatch without a catalog lookup", async () => {
    vi.mocked(fetchBoard).mockResolvedValue(S3_BOARD);
    const yaml = "esp8266:\n  board: esp01_1m\n";
    const api = makeApi(yaml);
    expect(await findBoardDisagreement(api, identityLocalize, DEVICE)).toBe(yaml);
    expect(api.getBoards).not.toHaveBeenCalled();
  });

  it("is null for an uncatalogued board string on the same chip", async () => {
    // No pick could satisfy a string test here.
    vi.mocked(fetchBoard).mockResolvedValue(C3_BOARD);
    const yaml = "esp32:\n  board: vendor-c3\n  variant: esp32c3\n";
    expect(
      await findBoardDisagreement(makeApi(yaml), identityLocalize, C3_DEVICE)
    ).toBeNull();
  });

  it("is null for an uncatalogued board string with no variant", async () => {
    vi.mocked(fetchBoard).mockResolvedValue(C3_BOARD);
    const yaml = "esp32:\n  board: vendor-mystery\n";
    expect(
      await findBoardDisagreement(makeApi(yaml), identityLocalize, C3_DEVICE)
    ).toBeNull();
  });

  it("flags an uncatalogued board string beside a differing variant", async () => {
    vi.mocked(fetchBoard).mockResolvedValue(S3_BOARD);
    const yaml = "esp32:\n  board: vendor-c3\n  variant: esp32c3\n";
    expect(await findBoardDisagreement(makeApi(yaml), identityLocalize, DEVICE)).toBe(
      yaml
    );
  });

  it("is null without a catalog lookup when the stored board has no variant", async () => {
    vi.mocked(fetchBoard).mockResolvedValue(
      makeSlimBoard("no-variant-board") as BoardCatalogEntry
    );
    const yaml = "esp32:\n  board: vendor-x\n  variant: esp32c3\n";
    const api = makeApi(yaml);
    expect(
      await findBoardDisagreement(api, identityLocalize, {
        configuration: "dev.yaml",
        board_id: "no-variant-board",
      })
    ).toBeNull();
    expect(api.getBoards).not.toHaveBeenCalled();
  });

  it("is null when a resolved board string names the stored chip", async () => {
    vi.mocked(fetchBoard).mockResolvedValue(C3_BOARD);
    const yaml = "esp32:\n  board: lolin_c3_mini\n";
    expect(
      await findBoardDisagreement(
        makeApi(yaml, [C3_SIBLING]),
        identityLocalize,
        C3_DEVICE
      )
    ).toBeNull();
  });

  it("flags a resolved board string naming a different chip", async () => {
    // The resolved string beats a stale explicit variant beside it.
    vi.mocked(fetchBoard).mockResolvedValue(S3_BOARD);
    const yaml = "esp32:\n  board: lolin_c3_mini\n  variant: esp32s3\n";
    expect(
      await findBoardDisagreement(makeApi(yaml, [C3_SIBLING]), identityLocalize, DEVICE)
    ).toBe(yaml);
  });

  it("flags a resolved LibreTiny board on a different mcu series", async () => {
    // LibreTiny YAMLs carry no variant; the chip rides the board string
    // and the catalog records it as the mcu series.
    const bk7231 = makeSlimBoard("cb2s", {
      platform: "bk72xx",
      board: "cb2s",
      mcu: "bk7231",
    }) as BoardCatalogEntry;
    const bk7238 = makeSlimBoard("cb3s-38", {
      platform: "bk72xx",
      board: "cb3s_38",
      mcu: "bk7238",
    });
    vi.mocked(fetchBoard).mockResolvedValue(bk7231);
    const yaml = "bk72xx:\n  board: cb3s_38\n";
    expect(
      await findBoardDisagreement(makeApi(yaml, [bk7238]), identityLocalize, {
        configuration: "dev.yaml",
        board_id: "cb2s",
      })
    ).toBe(yaml);
  });

  it("is null for an uncatalogued LibreTiny board string", async () => {
    const bk7231 = makeSlimBoard("cb2s", {
      platform: "bk72xx",
      board: "cb2s",
      mcu: "bk7231",
    }) as BoardCatalogEntry;
    vi.mocked(fetchBoard).mockResolvedValue(bk7231);
    const yaml = "bk72xx:\n  board: vendor-bk\n";
    expect(
      await findBoardDisagreement(makeApi(yaml), identityLocalize, {
        configuration: "dev.yaml",
        board_id: "cb2s",
      })
    ).toBeNull();
  });

  it("flags an rp2 variant against a different stored mcu series", async () => {
    const pico = makeSlimBoard("rpi-pico", {
      platform: "rp2",
      board: "rpipico",
      mcu: "rp2040",
    }) as BoardCatalogEntry;
    vi.mocked(fetchBoard).mockResolvedValue(pico);
    const yaml = "rp2:\n  variant: RP2350\n";
    const api = makeApi(yaml);
    expect(
      await findBoardDisagreement(api, identityLocalize, {
        configuration: "dev.yaml",
        board_id: "rpi-pico",
      })
    ).toBe(yaml);
    expect(api.getBoards).not.toHaveBeenCalled();
  });

  it("fails open with a warning toast on a fetch failure", async () => {
    // Fail open so install is never blocked on a backend blip, but keep
    // a persistent failure distinguishable from a genuine "agrees".
    vi.mocked(fetchBoard).mockResolvedValue(S3_BOARD);
    expect(
      await findBoardDisagreement(makeApi(new Error("boom")), identityLocalize, DEVICE)
    ).toBeNull();
    expect(toast.warning).toHaveBeenCalled();
  });
});
