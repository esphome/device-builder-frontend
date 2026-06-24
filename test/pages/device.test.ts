// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { EditorValidateResponse } from "../../src/api/types/editor.js";
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

interface SaveView {
  _api: ESPHomeAPI;
  id: string;
  _yaml: string;
  _savedYaml: string;
  _saving: boolean;
  _pendingValidationResolve: ((saved: boolean) => void) | null;
  _activeSection: { flushPending(): Promise<void> | void } | null;
  _saveYaml(): Promise<boolean>;
  _doSaveYaml(): Promise<boolean>;
}

function makeSaveView(api: Partial<ESPHomeAPI>): SaveView {
  const page = new ESPHomePageDevice() as unknown as SaveView;
  page._api = api as unknown as ESPHomeAPI;
  page.id = "editortest";
  page._yaml = "esphome:\n  name: x\n";
  page._savedYaml = ""; // _yaml !== _savedYaml, so the buffer reads dirty
  return page;
}

describe("esphome-page-device save re-entrancy", () => {
  test("refuses to start a save while one is already in flight", async () => {
    const validateYaml = vi.fn();
    const updateConfig = vi.fn();
    const page = makeSaveView({ validateYaml, updateConfig });
    page._saving = true; // a save is mid-validate

    expect(await page._saveYaml()).toBe(false);
    expect(validateYaml).not.toHaveBeenCalled();
    expect(updateConfig).not.toHaveBeenCalled();
  });

  test("refuses a re-entry while the validation-error dialog is open", async () => {
    // The validate-phase finally clears _saving so the spinner stops while the
    // dialog waits on the user, but _pendingValidationResolve stays set — the
    // guard must still treat that as a save in progress.
    const validateYaml = vi.fn();
    const updateConfig = vi.fn();
    const page = makeSaveView({ validateYaml, updateConfig });
    page._saving = false;
    page._pendingValidationResolve = () => {};

    expect(await page._saveYaml()).toBe(false);
    expect(validateYaml).not.toHaveBeenCalled();
    expect(updateConfig).not.toHaveBeenCalled();
  });

  test("clears the busy flag when flushPending rejects, so later saves aren't bricked", async () => {
    // flushPending is a backend upsert for the section editors; if it ever
    // rejects, the busy flag must not strand true and lock out every save.
    const flushPending = vi.fn(() => Promise.reject(new Error("upsert failed")));
    const validateYaml = vi.fn();
    const page = makeSaveView({ validateYaml });
    page._activeSection = { flushPending };

    await expect(page._saveYaml()).rejects.toThrow("upsert failed");
    expect(page._saving).toBe(false); // not stranded

    // The guard isn't stuck: a second attempt runs again (and rejects again).
    await expect(page._saveYaml()).rejects.toThrow("upsert failed");
    expect(flushPending).toHaveBeenCalledTimes(2);
    expect(validateYaml).not.toHaveBeenCalled();
  });

  test("a keyboard re-entry during validate doesn't launch a second save", async () => {
    // Hold validate in flight so the second (Cmd/Ctrl+S) re-entry lands while
    // the first save is still awaiting it; resolve at the end so nothing leaks.
    let resolveValidate!: (res: EditorValidateResponse) => void;
    const validateYaml = vi.fn(
      () => new Promise<EditorValidateResponse>((r) => (resolveValidate = r))
    );
    const page = makeSaveView({ validateYaml });
    // Stub the commit so the first run finishes without touching toasts.
    const doSave = vi.fn(() => Promise.resolve(true));
    page._doSaveYaml = doSave;

    const first = page._saveYaml(); // enters, sets _saving, awaits validateYaml
    await new Promise((r) => setTimeout(r, 0)); // flush to the validate await
    const second = await page._saveYaml(); // re-entry mid-validate
    expect(second).toBe(false);

    // Valid (no errors) → first run falls through to the stubbed commit.
    resolveValidate({ yaml_errors: [], validation_errors: [] });
    expect(await first).toBe(true);
    expect(validateYaml).toHaveBeenCalledTimes(1);
    expect(doSave).toHaveBeenCalledTimes(1);
  });
});
