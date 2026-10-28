// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("../../src/util/navigation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/util/navigation.js")>()),
  navigate: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../src/util/bulk-update.js", () => ({ runBulkUpdate: vi.fn() }));

import toast from "sonner-js";

import "../_mock-webawesome.js";
import { argsLocalize, flushMicrotasks } from "../_dom.js";
import { findTemplatesByAnchor } from "../_lit-template-walker.js";
import { APIError } from "../../src/api/api-error.js";
import type { ESPHomeAPI } from "../../src/api/index.js";
import { ESPHomePageFile } from "../../src/pages/file.js";
import { runBulkUpdate } from "../../src/util/bulk-update.js";
import { navigate } from "../../src/util/navigation.js";

vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("../../src/components/confirm-dialog.js", () => ({}));
vi.mock("../../src/components/packages/file-list-dialog.js", () => ({}));
vi.mock("../../src/components/unsaved-changes-dialog.js", () => ({}));
vi.mock("../../src/components/yaml-editor.js", () => ({}));

interface PageView {
  path: string;
  _load: { state: "loading" | "ready" | "error" | "missing" };
  _yaml: string;
  _savedYaml: string;
  _api: ESPHomeAPI;
  _localize: typeof argsLocalize;
  _deleteDialog?: { open(): void; close(): void };
  _save(): Promise<boolean>;
  _announceSaved(): Promise<void>;
  _confirmDelete(): Promise<void>;
  _delete(): Promise<void>;
  render(): unknown;
}

function makePage(overrides: Partial<PageView> = {}): PageView {
  const page = new ESPHomePageFile() as unknown as PageView;
  page.path = "common/base.yaml";
  page._load.state = "ready";
  page._yaml = "logger:\n";
  page._savedYaml = "logger:\n";
  page._localize = argsLocalize;
  Object.assign(page, overrides);
  return page;
}

type ToastAction = { label: string; onClick: () => void };
const lastToastOptions = (fn: unknown) =>
  (vi.mocked(
    fn as (m: string, o?: { action?: ToastAction; description?: string }) => void
  ).mock.lastCall?.[1] ?? {}) as { action?: ToastAction; description?: string };

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("esphome-page-file rendering", () => {
  test("shows the editor once loaded, without a device configuration", () => {
    const tree = makePage().render();
    expect(findTemplatesByAnchor(tree, "<esphome-yaml-editor")).toHaveLength(1);
    expect(findTemplatesByAnchor(tree, "<wa-spinner")).toHaveLength(0);
  });

  test("offers Delete for a package but not for a top-level file", () => {
    const pkg = makePage().render();
    expect(findTemplatesByAnchor(pkg, 'name="delete-outline"')).toHaveLength(1);
    const top = makePage({ path: "_shared.yaml" }).render();
    expect(findTemplatesByAnchor(top, 'name="delete-outline"')).toHaveLength(0);
  });
});

describe("esphome-page-file save", () => {
  test("sends the last-read text as expected and marks the buffer saved", async () => {
    const updateConfig = vi.fn().mockResolvedValue(undefined);
    const page = makePage({ _yaml: "logger:\n  level: INFO\n" });
    page._api = {
      updateConfig,
      getFileUsage: vi.fn().mockResolvedValue({ used_by: [], unknown: [] }),
    } as unknown as ESPHomeAPI;

    expect(await page._save()).toBe(true);

    expect(updateConfig).toHaveBeenCalledWith(
      "common/base.yaml",
      "logger:\n  level: INFO\n",
      {
        expected: "logger:\n",
      }
    );
    expect(page._savedYaml).toBe("logger:\n  level: INFO\n");
  });

  test("an outside edit keeps the buffer dirty and offers Reload", async () => {
    const page = makePage({ _yaml: "new: 1\n" });
    page._api = {
      updateConfig: vi
        .fn()
        .mockRejectedValue(new APIError("precondition_failed", "differs")),
    } as unknown as ESPHomeAPI;

    expect(await page._save()).toBe(false);

    expect(page._savedYaml).toBe("logger:\n");
    expect(toast.error).toHaveBeenCalledWith("file.changed_on_disk", expect.anything());
    expect(lastToastOptions(toast.error).action?.label).toBe("file.reload");
  });

  test("any other failure toasts the backend detail", async () => {
    const page = makePage({ _yaml: "new: 1\n" });
    page._api = {
      updateConfig: vi.fn().mockRejectedValue(new APIError("invalid_args", "empty")),
    } as unknown as ESPHomeAPI;

    expect(await page._save()).toBe(false);
    expect(vi.mocked(toast.error).mock.lastCall?.[0]).toBe("file.save_error: empty");
  });

  test("a file other devices use offers to install them", async () => {
    const page = makePage();
    page._api = {
      getFileUsage: vi
        .fn()
        .mockResolvedValue({ used_by: ["a.yaml", "b.yaml"], unknown: [] }),
    } as unknown as ESPHomeAPI;

    await page._announceSaved();

    const options = lastToastOptions(toast.success);
    expect(options.description).toBe("file.saved_used_by | 2");
    options.action!.onClick();
    expect(runBulkUpdate).toHaveBeenCalledWith(["a.yaml", "b.yaml"], expect.anything());
  });

  test("an unused file just confirms the save", async () => {
    const page = makePage();
    page._api = {
      getFileUsage: vi.fn().mockResolvedValue({ used_by: [], unknown: [] }),
    } as unknown as ESPHomeAPI;

    await page._announceSaved();

    expect(vi.mocked(toast.success).mock.lastCall?.[0]).toBe("file.saved");
    expect(lastToastOptions(toast.success).action).toBeUndefined();
  });
});

describe("esphome-page-file delete", () => {
  test("lists the users before confirming", async () => {
    const open = vi.fn();
    const page = makePage();
    // ``@query`` installs a getter; shadow it on the instance.
    Object.defineProperty(page, "_deleteDialog", { value: { open, close: vi.fn() } });
    page._api = {
      getFileUsage: vi.fn().mockResolvedValue({ used_by: ["a.yaml"], unknown: [] }),
    } as unknown as ESPHomeAPI;

    await page._confirmDelete();

    expect((page as unknown as { _deleteUsers: string[] })._deleteUsers).toEqual([
      "a.yaml",
    ]);
    expect(open).toHaveBeenCalledOnce();
  });

  test("deletes and returns to the packages list without a save prompt", async () => {
    const deleteFile = vi.fn().mockResolvedValue(undefined);
    const page = makePage({ _yaml: "unsaved: 1\n" });
    page._api = { deleteFile } as unknown as ESPHomeAPI;

    await page._delete();

    expect(deleteFile).toHaveBeenCalledWith("common/base.yaml");
    expect(page._savedYaml).toBe(page._yaml);
    expect(navigate).toHaveBeenCalledWith("/packages");
  });

  test("a failed delete stays on the page", async () => {
    const page = makePage();
    page._api = {
      deleteFile: vi.fn().mockRejectedValue(new APIError("not_found", "gone")),
    } as unknown as ESPHomeAPI;

    await page._delete();

    expect(navigate).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.lastCall?.[0]).toBe(
      "packages.delete_failed: gone"
    );
  });
});

describe("esphome-page-file load", () => {
  test("loads the routed path and reloads when the path changes", async () => {
    const getConfig = vi.fn().mockResolvedValue("a: 1\n");
    const page = new ESPHomePageFile();
    (page as unknown as { _api: ESPHomeAPI })._api = {
      ready: Promise.resolve(),
      getConfig,
    } as unknown as ESPHomeAPI;
    page.path = "common/a.yaml";
    document.body.appendChild(page);
    await flushMicrotasks(8);
    page.path = "common/b.yaml";
    await flushMicrotasks(8);

    expect(getConfig.mock.calls.map((c) => c[0])).toEqual([
      "common/a.yaml",
      "common/b.yaml",
    ]);
    page.remove();
  });
});
