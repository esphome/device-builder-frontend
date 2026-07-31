// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import toast from "sonner-js";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { EditorValidateResponse } from "../../src/api/types/editor.js";
import type { FirmwareJob } from "../../src/api/types/firmware-jobs.js";
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

interface InstallView {
  id: string;
  _installCtrl: { onInstall: () => void; onUpdate: () => void };
  _activeJobs: Map<string, FirmwareJob>;
  _commandDialog: { followJob(job: FirmwareJob, displayName: string): void };
  _saveYaml(): Promise<boolean>;
  _saveThenInstall(): Promise<void>;
  _saveThenUpdate(): Promise<void>;
}

function makeInstallView(saveResult: boolean): {
  page: InstallView;
  onInstall: ReturnType<typeof vi.fn>;
  onUpdate: ReturnType<typeof vi.fn>;
  saveYaml: ReturnType<typeof vi.fn>;
} {
  const page = new ESPHomePageDevice() as unknown as InstallView;
  const onInstall = vi.fn();
  const onUpdate = vi.fn();
  const saveYaml = vi.fn(() => Promise.resolve(saveResult));
  page._installCtrl = { onInstall, onUpdate };
  page._saveYaml = saveYaml;
  return { page, onInstall, onUpdate, saveYaml };
}

describe("esphome-page-device save before install", () => {
  test("saves the buffer, then installs, when the save succeeds", async () => {
    const { page, onInstall, saveYaml } = makeInstallView(true);
    await page._saveThenInstall();
    expect(saveYaml).toHaveBeenCalledTimes(1);
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  test("saves the buffer, then updates, when the save succeeds", async () => {
    const { page, onUpdate, saveYaml } = makeInstallView(true);
    await page._saveThenUpdate();
    expect(saveYaml).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  test("does not install when the save is cancelled or fails", async () => {
    // The regression pin: a refused save must abort the build so it can't
    // flash the stale on-disk version.
    const { page, onInstall, onUpdate } = makeInstallView(false);
    await page._saveThenInstall();
    await page._saveThenUpdate();
    expect(onInstall).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test("aborts the build and toasts when the save rejects, with no unhandled rejection", async () => {
    // _saveYaml rejects when a section editor's flushPending upsert fails; the
    // wrapper must catch it, surface an error, and not build.
    const { page, onInstall } = makeInstallView(true);
    page._saveYaml = vi.fn(() => Promise.reject(new Error("upsert failed")));
    await expect(page._saveThenInstall()).resolves.toBeUndefined();
    expect(onInstall).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
  });
});

function makeBusyInstallView(): ReturnType<typeof makeInstallView> & {
  followJob: ReturnType<typeof vi.fn>;
  job: FirmwareJob;
} {
  const view = makeInstallView(true);
  const job = { job_id: "job-1", configuration: "kitchen.yaml" } as FirmwareJob;
  const otherJob = { job_id: "job-2", configuration: "garage.yaml" } as FirmwareJob;
  view.page.id = "kitchen.yaml";
  // A second device's concurrent job proves the lookup keys on this page's id.
  view.page._activeJobs = new Map([
    ["garage.yaml", otherJob],
    ["kitchen.yaml", job],
  ]);
  const followJob = vi.fn();
  // _commandDialog is a @query getter on the prototype; shadow it.
  Object.defineProperty(view.page, "_commandDialog", { value: { followJob } });
  return { ...view, followJob, job };
}

describe("esphome-page-device install while a job is running", () => {
  test("update re-attaches to the running job: no save, no new build", async () => {
    const { page, onUpdate, saveYaml, followJob, job } = makeBusyInstallView();
    await page._saveThenUpdate();
    expect(followJob).toHaveBeenCalledTimes(1);
    expect(followJob.mock.calls[0][0]).toBe(job);
    expect(saveYaml).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test("install re-attaches to the running job: no save, no new build", async () => {
    const { page, onInstall, saveYaml, followJob, job } = makeBusyInstallView();
    await page._saveThenInstall();
    expect(followJob).toHaveBeenCalledTimes(1);
    expect(followJob.mock.calls[0][0]).toBe(job);
    expect(saveYaml).not.toHaveBeenCalled();
    expect(onInstall).not.toHaveBeenCalled();
  });

  test("with no active job the save-then-install path runs unchanged", async () => {
    const { page, onInstall, saveYaml, followJob } = makeBusyInstallView();
    page._activeJobs = new Map();
    await page._saveThenInstall();
    expect(followJob).not.toHaveBeenCalled();
    expect(saveYaml).toHaveBeenCalledTimes(1);
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  test("another device's running job doesn't hijack this page's install", async () => {
    const { page, onInstall, saveYaml, followJob } = makeBusyInstallView();
    page._activeJobs = new Map([
      ["garage.yaml", { job_id: "job-2", configuration: "garage.yaml" } as FirmwareJob],
    ]);
    await page._saveThenInstall();
    expect(followJob).not.toHaveBeenCalled();
    expect(saveYaml).toHaveBeenCalledTimes(1);
    expect(onInstall).toHaveBeenCalledTimes(1);
  });
});
