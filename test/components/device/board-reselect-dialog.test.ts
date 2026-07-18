/**
 * @vitest-environment happy-dom
 *
 * Pins the reselect flow's candidate resolution (exact PlatformIO match
 * first, platform/variant fallback) and the select → devices/update apply.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/badge/badge.js", () => ({}));
vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import toast from "sonner-js";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { SlimBoard } from "../../../src/api/types/boards.js";
import { ESPHomeBoardReselectDialog } from "../../../src/components/device/board-reselect-dialog.js";
import type { ESPHomeChangeBoardDialog } from "../../../src/components/device/change-board-dialog.js";
import { mount } from "../../_dom.js";

function slimBoard(id: string, esphome: Partial<SlimBoard["esphome"]>): SlimBoard {
  return {
    id,
    name: id,
    images: [],
    esphome: { platform: "esp32", board: id, variant: null, ...esphome },
  } as unknown as SlimBoard;
}

const C3_CURATED = slimBoard("c3-curated", {
  board: "esp32-c3-devkitm-1",
  variant: "esp32c3",
});
const C3_GENERIC = slimBoard("esp32-c3-devkitm-1", {
  board: "esp32-c3-devkitm-1",
  variant: "esp32c3",
});
const S3_NOISE = slimBoard("s3-board", {
  board: "esp32-s3-devkitc-1",
  variant: "esp32s3",
});

async function makeDialog(api: Partial<ESPHomeAPI>) {
  const el = await mount(new ESPHomeBoardReselectDialog());
  Object.assign(el, { _api: api });
  const inner = () =>
    el.shadowRoot!.querySelector<ESPHomeChangeBoardDialog>(
      "esphome-change-board-dialog"
    )!;
  return { el, inner };
}

describe("board-reselect-dialog", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lists only boards exact-matching the YAML board string", async () => {
    const getBoards = vi.fn().mockResolvedValue({
      boards: [C3_CURATED, C3_GENERIC, S3_NOISE],
    });
    const { el, inner } = await makeDialog({ getBoards } as unknown as ESPHomeAPI);
    await el.open({
      configuration: "dev.yaml",
      yaml: "esp32:\n  board: esp32-c3-devkitm-1\n",
    });
    await el.updateComplete;
    expect(getBoards).toHaveBeenCalledWith({ query: "esp32-c3-devkitm-1", limit: 50 });
    expect(inner().boards).toEqual([C3_CURATED, C3_GENERIC]);
    expect((inner() as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(
      true
    );
  });

  it("lists same-variant boards for a variant-only YAML", async () => {
    const getBoards = vi.fn().mockResolvedValue({ boards: [C3_CURATED, C3_GENERIC] });
    const { el, inner } = await makeDialog({ getBoards } as unknown as ESPHomeAPI);
    await el.open({
      configuration: "dev.yaml",
      yaml: "esp32:\n  variant: ESP32C3\n",
    });
    expect(getBoards).toHaveBeenCalledTimes(1);
    expect(getBoards).toHaveBeenCalledWith({
      platform: "esp32",
      variant: "esp32c3",
      limit: 50,
    });
    expect(inner().boards).toEqual([C3_CURATED, C3_GENERIC]);
  });

  it("falls back to same-variant boards when the catalog lacks the board string", async () => {
    const getBoards = vi
      .fn()
      .mockResolvedValueOnce({ boards: [S3_NOISE] })
      .mockResolvedValueOnce({ boards: [C3_CURATED, C3_GENERIC] });
    const { el, inner } = await makeDialog({ getBoards } as unknown as ESPHomeAPI);
    await el.open({
      configuration: "dev.yaml",
      yaml: "esp32:\n  board: some-exotic-c3\n  variant: ESP32C3\n",
    });
    expect(getBoards).toHaveBeenLastCalledWith({
      platform: "esp32",
      variant: "esp32c3",
      limit: 50,
    });
    expect(inner().boards).toEqual([C3_CURATED, C3_GENERIC]);
  });

  it("toasts and stays closed when the YAML pins neither board nor variant", async () => {
    // Nothing to derive a compatible set from — never offer a loose list.
    const getBoards = vi.fn().mockResolvedValue({ boards: [C3_CURATED] });
    const { el, inner } = await makeDialog({ getBoards } as unknown as ESPHomeAPI);
    await el.open({
      configuration: "dev.yaml",
      yaml: "packages:\n  base: !include base.yaml\n",
    });
    expect(getBoards).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect((inner() as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(
      false
    );
  });

  it("applies the pick via devices/update and emits board-changed", async () => {
    const api = {
      getBoards: vi.fn().mockResolvedValue({ boards: [C3_CURATED] }),
      updateDevice: vi.fn().mockResolvedValue({}),
    };
    const { el, inner } = await makeDialog(api as unknown as ESPHomeAPI);
    const onChanged = vi.fn();
    el.addEventListener("board-changed", onChanged as EventListener);
    await el.open({
      configuration: "dev.yaml",
      yaml: "esp32:\n  board: esp32-c3-devkitm-1\n",
    });
    inner().dispatchEvent(
      new CustomEvent("select-board", {
        detail: { boardId: "c3-curated" },
        bubbles: true,
        composed: true,
      })
    );
    await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalled());
    expect(api.updateDevice).toHaveBeenCalledWith({
      configuration: "dev.yaml",
      board_id: "c3-curated",
    });
    expect(toast.success).toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect((onChanged.mock.calls[0][0] as CustomEvent).detail).toEqual({
      configuration: "dev.yaml",
      boardId: "c3-curated",
    });
  });

  it("toasts an error and emits nothing when the update fails", async () => {
    const api = {
      getBoards: vi.fn().mockResolvedValue({ boards: [C3_CURATED] }),
      updateDevice: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const { el, inner } = await makeDialog(api as unknown as ESPHomeAPI);
    const onChanged = vi.fn();
    el.addEventListener("board-changed", onChanged as EventListener);
    await el.open({
      configuration: "dev.yaml",
      yaml: "esp32:\n  board: esp32-c3-devkitm-1\n",
    });
    inner().dispatchEvent(
      new CustomEvent("select-board", {
        detail: { boardId: "c3-curated" },
        bubbles: true,
        composed: true,
      })
    );
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("fetches the YAML when the caller passes none", async () => {
    const api = {
      getConfig: vi.fn().mockResolvedValue("esp32:\n  board: esp32-c3-devkitm-1\n"),
      getBoards: vi.fn().mockResolvedValue({ boards: [C3_CURATED] }),
    };
    const { el } = await makeDialog(api as unknown as ESPHomeAPI);
    await el.open({ configuration: "dev.yaml" });
    expect(api.getConfig).toHaveBeenCalledWith("dev.yaml");
    expect(api.getBoards).toHaveBeenCalledWith({
      query: "esp32-c3-devkitm-1",
      limit: 50,
    });
  });
});
