// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import type { ESPHomeAPI } from "../../src/api/index.js";
import type { BoardCatalogEntry } from "../../src/api/types/boards.js";
import { ESPHomePageDevice } from "../../src/pages/device.js";

/**
 * Pin the post-save board-reselect prompt: fires once per disagreement,
 * suppressed during install-triggered saves, silent on a failed save.
 */

interface PageView {
  id: string;
  _yaml: string;
  _savedYaml: string;
  _board: BoardCatalogEntry | null;
  _suppressBoardPrompt: boolean;
  _api: ESPHomeAPI;
  _doSaveYaml(): Promise<boolean>;
  _saveYaml(): Promise<boolean>;
  _showActiveJobProgress(): boolean;
  _installAfterSave(run: () => void): Promise<void>;
}

const S3_BOARD = {
  esphome: { platform: "esp32", board: "esp32-s3-devkitc-1", variant: "esp32s3" },
} as BoardCatalogEntry;

const C3_YAML = "esp32:\n  board: esp32-c3-devkitm-1\n";

function makePage(overrides: Partial<PageView> = {}) {
  const page = new ESPHomePageDevice() as unknown as PageView;
  const openReselect = vi.fn().mockResolvedValue(true);
  Object.assign(page, {
    id: "dev.yaml",
    _yaml: C3_YAML,
    _savedYaml: "",
    _board: S3_BOARD,
    _api: { updateConfig: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  });
  // Shadow the @query accessor with the stub dialog.
  Object.defineProperty(page, "_boardReselectDialog", {
    value: { open: openReselect },
  });
  return { page, openReselect };
}

describe("post-save board reselect prompt", () => {
  it("opens the reselect dialog when the saved YAML disagrees with the board", async () => {
    const { page, openReselect } = makePage();
    await page._doSaveYaml();
    expect(openReselect).toHaveBeenCalledTimes(1);
    expect(openReselect).toHaveBeenCalledWith({
      configuration: "dev.yaml",
      yaml: C3_YAML,
    });
  });

  it("prompts once for the same dismissed disagreement", async () => {
    const { page, openReselect } = makePage();
    await page._doSaveYaml();
    await page._doSaveYaml();
    expect(openReselect).toHaveBeenCalledTimes(1);
  });

  it("re-offers the prompt when the picker failed to open", async () => {
    // A transient fetch failure must not permanently suppress the prompt.
    const { page, openReselect } = makePage();
    openReselect.mockResolvedValueOnce(false);
    await page._doSaveYaml();
    await vi.waitFor(() => expect(openReselect).toHaveBeenCalledTimes(1));
    await page._doSaveYaml();
    await vi.waitFor(() => expect(openReselect).toHaveBeenCalledTimes(2));
  });

  it("stays quiet while an install-triggered save runs", async () => {
    const { page, openReselect } = makePage({ _suppressBoardPrompt: true });
    await page._doSaveYaml();
    expect(openReselect).not.toHaveBeenCalled();
  });

  it("stays quiet when the YAML agrees with the board", async () => {
    const { page, openReselect } = makePage({
      _yaml: "esp32:\n  board: esp32-s3-devkitc-1\n",
    });
    await page._doSaveYaml();
    expect(openReselect).not.toHaveBeenCalled();
  });

  it("stays quiet with no loaded board", async () => {
    const { page, openReselect } = makePage({ _board: null });
    await page._doSaveYaml();
    expect(openReselect).not.toHaveBeenCalled();
  });

  it("stays quiet when the save fails", async () => {
    const { page, openReselect } = makePage({
      _api: {
        updateConfig: vi.fn().mockRejectedValue(new Error("boom")),
      } as unknown as ESPHomeAPI,
    });
    await page._doSaveYaml();
    expect(openReselect).not.toHaveBeenCalled();
  });
});

describe("install hard block on board disagreement", () => {
  function makeInstallPage(overrides: Partial<PageView> = {}) {
    const made = makePage({
      _showActiveJobProgress: () => false,
      _saveYaml: async () => true,
      ...overrides,
    });
    return { ...made, run: vi.fn() };
  }

  it("blocks install and opens the picker while the YAML disagrees", async () => {
    const { page, openReselect, run } = makeInstallPage();
    await page._installAfterSave(run);
    expect(run).not.toHaveBeenCalled();
    expect(openReselect).toHaveBeenCalledWith({
      configuration: "dev.yaml",
      yaml: C3_YAML,
    });
  });

  it("re-prompts on every blocked install click", async () => {
    // Unlike the post-save prompt, the block has no dismissed-state memo.
    const { page, openReselect, run } = makeInstallPage();
    await page._installAfterSave(run);
    await page._installAfterSave(run);
    expect(run).not.toHaveBeenCalled();
    expect(openReselect).toHaveBeenCalledTimes(2);
  });

  it("falls through to the install when the picker has nothing to offer", async () => {
    const { page, openReselect, run } = makeInstallPage();
    openReselect.mockResolvedValue(false);
    await page._installAfterSave(run);
    expect(openReselect).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs the install once the YAML agrees", async () => {
    const { page, openReselect, run } = makeInstallPage({
      _yaml: "esp32:\n  board: esp32-s3-devkitc-1\n",
    });
    await page._installAfterSave(run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(openReselect).not.toHaveBeenCalled();
  });

  it("does not block when the save was refused", async () => {
    const { page, openReselect, run } = makeInstallPage({
      _saveYaml: async () => false,
    });
    await page._installAfterSave(run);
    expect(run).not.toHaveBeenCalled();
    expect(openReselect).not.toHaveBeenCalled();
  });
});
