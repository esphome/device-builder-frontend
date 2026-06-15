// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { DeviceLayoutMode } from "../../src/components/device/device-editor.js";
import { ESPHomePageDevice } from "../../src/pages/device.js";

/**
 * Pin the device-editor layout persistence: backend seed when localStorage
 * is empty, an in-flight toggle winning over the seed, and the
 * cache-only vs cache-plus-backend writer split.
 */

interface PageView {
  _layout: DeviceLayoutMode;
  _navCollapsed: boolean;
  _api: ESPHomeAPI;
  _loadPreferences(): Promise<void>;
  _cacheLayout(mode: DeviceLayoutMode): void;
  _persistLayout(mode: DeviceLayoutMode): void;
}

function makePage(overrides: Partial<PageView> = {}): PageView {
  const page = new ESPHomePageDevice() as unknown as PageView;
  Object.assign(page, overrides);
  return page;
}

describe("esphome-page-device layout persistence", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  test("seeds the layout from the backend pref when localStorage is empty", async () => {
    const getPreferences = vi.fn(() =>
      Promise.resolve({ navigator_visible: true, device_editor_layout: "yaml" })
    );
    const page = makePage({ _layout: "both" });
    page._api = { getPreferences } as unknown as ESPHomeAPI;
    await page._loadPreferences();
    expect(page._layout).toBe("right");
  });

  test("seeds from the backend when localStorage holds an invalid value", async () => {
    localStorage.setItem("esphome-editor-layout", "garbage");
    const getPreferences = vi.fn(() =>
      Promise.resolve({ navigator_visible: true, device_editor_layout: "yaml" })
    );
    const page = makePage({ _layout: "both" });
    page._api = { getPreferences } as unknown as ESPHomeAPI;
    await page._loadPreferences();
    expect(page._layout).toBe("right");
  });

  test("defers to a layout the user toggled while the seed fetch was in flight", async () => {
    const getPreferences = vi.fn(() => {
      // The user toggled mid-fetch, so _persistLayout wrote localStorage.
      localStorage.setItem("esphome-editor-layout", "left");
      return Promise.resolve({ navigator_visible: true, device_editor_layout: "yaml" });
    });
    const page = makePage({ _layout: "left" });
    page._api = { getPreferences } as unknown as ESPHomeAPI;
    await page._loadPreferences();
    expect(page._layout).toBe("left");
  });

  test("_persistLayout caches locally and records the cross-browser pref", () => {
    const updatePreferences = vi.fn(() => Promise.resolve());
    const page = makePage();
    page._api = { updatePreferences } as unknown as ESPHomeAPI;
    page._persistLayout("right");
    expect(page._layout).toBe("right");
    expect(localStorage.getItem("esphome-editor-layout")).toBe("right");
    expect(updatePreferences).toHaveBeenCalledWith({ device_editor_layout: "yaml" });
  });

  test("_cacheLayout persists locally without recording a backend pref", () => {
    const updatePreferences = vi.fn(() => Promise.resolve());
    const page = makePage();
    page._api = { updatePreferences } as unknown as ESPHomeAPI;
    page._cacheLayout("both");
    expect(page._layout).toBe("both");
    expect(localStorage.getItem("esphome-editor-layout")).toBe("both");
    expect(updatePreferences).not.toHaveBeenCalled();
  });
});
