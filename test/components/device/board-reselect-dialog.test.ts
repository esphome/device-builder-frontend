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
import { ESPHomeBoardReselectDialog } from "../../../src/components/device/board-reselect-dialog.js";
import type { ESPHomeChangeBoardDialog } from "../../../src/components/device/change-board-dialog.js";
import { mount } from "../../_dom.js";
import { makeSlimBoard } from "../../_make-slim-board.js";

const C3_CURATED = makeSlimBoard("c3-curated", {
  board: "esp32-c3-devkitm-1",
  variant: "esp32c3",
});
const C3_GENERIC = makeSlimBoard("esp32-c3-devkitm-1", {
  board: "esp32-c3-devkitm-1",
  variant: "esp32c3",
});
const S3_NOISE = makeSlimBoard("s3-board", {
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

  it("lists the full compatible set for an exact YAML board match", async () => {
    const getBoards = vi.fn().mockResolvedValue({
      boards: [C3_CURATED, C3_GENERIC, S3_NOISE],
    });
    // The complete same-target set comes from get_compatible_boards, not
    // the capped query search.
    const getCompatibleBoards = vi.fn().mockResolvedValue([C3_CURATED, C3_GENERIC]);
    const { el, inner } = await makeDialog({
      getBoards,
      getCompatibleBoards,
    } as unknown as ESPHomeAPI);
    const opened = await el.open({
      configuration: "dev.yaml",
      yaml: "esp32:\n  board: esp32-c3-devkitm-1\n",
    });
    await el.updateComplete;
    expect(opened).toBe(true);
    expect(getBoards).toHaveBeenCalledWith({ query: "esp32-c3-devkitm-1", limit: 100 });
    expect(getCompatibleBoards).toHaveBeenCalledWith("c3-curated");
    expect(inner().boards).toEqual([C3_CURATED, C3_GENERIC]);
    expect((inner() as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(
      true
    );
  });

  it("lists same-variant boards for a variant-only YAML", async () => {
    const getBoards = vi
      .fn()
      .mockResolvedValue({ boards: [C3_CURATED, C3_GENERIC], total: 2 });
    const { el, inner } = await makeDialog({ getBoards } as unknown as ESPHomeAPI);
    await el.open({
      configuration: "dev.yaml",
      yaml: "esp32:\n  variant: ESP32C3\n",
    });
    // The probe seeds the paged list's first page — no duplicate fetch.
    expect(getBoards).toHaveBeenCalledTimes(1);
    expect(getBoards).toHaveBeenCalledWith({
      platform: "esp32",
      variant: "esp32c3",
      offset: 0,
      limit: 50,
    });
    await vi.waitFor(() => expect(inner().boards).toEqual([C3_CURATED, C3_GENERIC]));
    expect(inner().hasMore).toBe(false);
  });

  it("falls back to same-variant boards when the catalog lacks the board string", async () => {
    const getBoards = vi
      .fn()
      .mockResolvedValueOnce({ boards: [S3_NOISE] })
      .mockResolvedValueOnce({ boards: [C3_CURATED, C3_GENERIC], total: 2 });
    const { el, inner } = await makeDialog({ getBoards } as unknown as ESPHomeAPI);
    await el.open({
      configuration: "dev.yaml",
      yaml: "esp32:\n  board: some-exotic-c3\n  variant: ESP32C3\n",
    });
    expect(getBoards).toHaveBeenLastCalledWith({
      platform: "esp32",
      variant: "esp32c3",
      offset: 0,
      limit: 50,
    });
    await vi.waitFor(() => expect(inner().boards).toEqual([C3_CURATED, C3_GENERIC]));
  });

  it("pages the variant listing on load-more", async () => {
    const getBoards = vi
      .fn()
      .mockResolvedValueOnce({ boards: [C3_CURATED], total: 2 })
      .mockResolvedValueOnce({ boards: [C3_GENERIC], total: 2 });
    const { el, inner } = await makeDialog({ getBoards } as unknown as ESPHomeAPI);
    await el.open({
      configuration: "dev.yaml",
      yaml: "esp32:\n  variant: ESP32C3\n",
    });
    await vi.waitFor(() => expect(inner().hasMore).toBe(true));
    inner().dispatchEvent(new CustomEvent("load-more"));
    await vi.waitFor(() => expect(inner().boards).toEqual([C3_CURATED, C3_GENERIC]));
    expect(getBoards).toHaveBeenLastCalledWith({
      platform: "esp32",
      variant: "esp32c3",
      offset: 1,
      limit: 50,
    });
    expect(inner().hasMore).toBe(false);
  });

  it("filters the exact-match set client-side on search", async () => {
    const heltec = makeSlimBoard("heltec-wifi-kit", {
      board: "esp32-c3-devkitm-1",
      variant: "esp32c3",
    });
    const api = {
      getBoards: vi.fn().mockResolvedValue({ boards: [C3_CURATED] }),
      getCompatibleBoards: vi.fn().mockResolvedValue([C3_CURATED, heltec]),
    };
    const { el, inner } = await makeDialog(api as unknown as ESPHomeAPI);
    await el.open({
      configuration: "dev.yaml",
      yaml: "esp32:\n  board: esp32-c3-devkitm-1\n",
    });
    inner().dispatchEvent(
      new CustomEvent("search-changed", { detail: { value: "heltec" } })
    );
    await vi.waitFor(() => expect(inner().boards).toEqual([heltec]));
    // No server round-trip for the complete exact set.
    expect(api.getBoards).toHaveBeenCalledTimes(1);
  });

  it("re-queries the paged variant listing on search", async () => {
    const getBoards = vi
      .fn()
      .mockResolvedValue({ boards: [C3_CURATED, C3_GENERIC], total: 2 });
    const { el, inner } = await makeDialog({ getBoards } as unknown as ESPHomeAPI);
    await el.open({
      configuration: "dev.yaml",
      yaml: "esp32:\n  variant: ESP32C3\n",
    });
    inner().dispatchEvent(
      new CustomEvent("search-changed", { detail: { value: "devkit" } })
    );
    await vi.waitFor(() =>
      expect(getBoards).toHaveBeenLastCalledWith({
        platform: "esp32",
        variant: "esp32c3",
        query: "devkit",
        offset: 0,
        limit: 50,
      })
    );
  });

  it("marks a failed search re-query as an error, not an empty catalog", async () => {
    const getBoards = vi
      .fn()
      .mockResolvedValueOnce({ boards: [C3_CURATED], total: 1 })
      .mockRejectedValueOnce(new Error("boom"));
    const { el, inner } = await makeDialog({ getBoards } as unknown as ESPHomeAPI);
    await el.open({
      configuration: "dev.yaml",
      yaml: "esp32:\n  variant: ESP32C3\n",
    });
    inner().dispatchEvent(
      new CustomEvent("search-changed", { detail: { value: "ghost" } })
    );
    await vi.waitFor(() => expect(inner().loadError).toBe(true));
    expect(inner().boards).toEqual([]);
  });

  it("toasts and stays closed when the YAML pins neither board nor variant", async () => {
    // Nothing to derive a compatible set from — never offer a loose list.
    const getBoards = vi.fn().mockResolvedValue({ boards: [C3_CURATED] });
    const { el, inner } = await makeDialog({ getBoards } as unknown as ESPHomeAPI);
    const opened = await el.open({
      configuration: "dev.yaml",
      yaml: "packages:\n  base: !include base.yaml\n",
    });
    expect(opened).toBe(false);
    expect(getBoards).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect((inner() as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(
      false
    );
  });

  it("uses the no-platform toast for a bare platform block", async () => {
    // A platform label isn't matchable; "match \"esp32\"" would mislead.
    const getBoards = vi.fn().mockResolvedValue({ boards: [C3_CURATED] });
    const { el } = await makeDialog({ getBoards } as unknown as ESPHomeAPI);
    expect(await el.open({ configuration: "dev.yaml", yaml: "esp32:\n" })).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      "device.board_reselect_no_platform",
      expect.anything()
    );
  });

  it("falls through to the variant listing on an empty compatible set", async () => {
    // An anomalous empty response must not open an empty picker.
    const getBoards = vi
      .fn()
      .mockResolvedValueOnce({ boards: [C3_CURATED] })
      .mockResolvedValueOnce({ boards: [C3_CURATED, C3_GENERIC], total: 2 });
    const getCompatibleBoards = vi.fn().mockResolvedValue([]);
    const { el, inner } = await makeDialog({
      getBoards,
      getCompatibleBoards,
    } as unknown as ESPHomeAPI);
    const opened = await el.open({
      configuration: "dev.yaml",
      yaml: "esp32:\n  board: esp32-c3-devkitm-1\n  variant: ESP32C3\n",
    });
    expect(opened).toBe(true);
    expect(getBoards).toHaveBeenLastCalledWith({
      platform: "esp32",
      variant: "esp32c3",
      offset: 0,
      limit: 50,
    });
    await vi.waitFor(() => expect(inner().boards).toEqual([C3_CURATED, C3_GENERIC]));
  });

  it("applies the pick via devices/update and emits board-changed", async () => {
    const api = {
      getBoards: vi.fn().mockResolvedValue({ boards: [C3_CURATED] }),
      getCompatibleBoards: vi.fn().mockResolvedValue([C3_CURATED]),
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
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(api.updateDevice).toHaveBeenCalledWith({
      configuration: "dev.yaml",
      board_id: "c3-curated",
    });
    expect(toast.success).toHaveBeenCalled();
    expect((onChanged.mock.calls[0][0] as CustomEvent).detail).toEqual({
      configuration: "dev.yaml",
      boardId: "c3-curated",
    });
  });

  it("toasts an error and emits nothing when the update fails", async () => {
    const api = {
      getBoards: vi.fn().mockResolvedValue({ boards: [C3_CURATED] }),
      getCompatibleBoards: vi.fn().mockResolvedValue([C3_CURATED]),
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
      getCompatibleBoards: vi.fn().mockResolvedValue([C3_CURATED]),
    };
    const { el } = await makeDialog(api as unknown as ESPHomeAPI);
    await el.open({ configuration: "dev.yaml" });
    expect(api.getConfig).toHaveBeenCalledWith("dev.yaml");
    expect(api.getBoards).toHaveBeenCalledWith({
      query: "esp32-c3-devkitm-1",
      limit: 100,
    });
  });
});
