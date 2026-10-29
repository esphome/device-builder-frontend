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
vi.mock("../../src/components/packages/delete-file-dialog.js", () => ({}));
vi.mock("../../src/components/device/device-navigator.js", () => ({}));
vi.mock("../../src/components/packages/file-list-dialog.js", () => ({}));
vi.mock("../../src/components/packages/rename-file-dialog.js", () => ({}));
vi.mock("../../src/components/unsaved-changes-dialog.js", () => ({}));
vi.mock("../../src/components/yaml-editor.js", () => ({}));

interface PageView {
  path: string;
  _load: { state: "loading" | "ready" | "error" | "missing" };
  _yaml: string;
  _savedYaml: string;
  _api: ESPHomeAPI;
  _localize: typeof argsLocalize;
  _deleteDialog?: { open(path: string): void };
  _save(): Promise<boolean>;
  _announceSaved(path: string): Promise<void>;
  _confirmDelete(): void;
  _onDeleted(e: CustomEvent<{ path: string }>): void;
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

  test("a save finishing after switching files leaves the new file alone", async () => {
    let finish!: () => void;
    const getFileUsage = vi.fn();
    const page = makePage({ _yaml: "a: 1\n" });
    page._api = {
      updateConfig: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
      getFileUsage,
    } as unknown as ESPHomeAPI;

    const saved = page._save();
    Object.assign(page, { path: "common/other.yaml", _savedYaml: "b: 1\n" });
    finish();

    expect(await saved).toBe(true);
    expect(page._savedYaml).toBe("b: 1\n");
    expect(getFileUsage).not.toHaveBeenCalled();
  });

  test("a second save joins the write in flight", async () => {
    let finish!: () => void;
    const updateConfig = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const page = makePage({ _yaml: "a: 1\n" });
    page._api = {
      updateConfig,
      getFileUsage: vi.fn().mockResolvedValue({ used_by: [], unknown: [] }),
    } as unknown as ESPHomeAPI;

    const first = page._save();
    const second = page._save();
    finish();

    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(updateConfig).toHaveBeenCalledTimes(1);
  });

  test("a save of another file does not join the write in flight", async () => {
    let finish!: () => void;
    const updateConfig = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const page = makePage({ _yaml: "a: 1\n" });
    page._api = {
      updateConfig,
      getFileUsage: vi.fn().mockResolvedValue({ used_by: [], unknown: [] }),
    } as unknown as ESPHomeAPI;

    const first = page._save();
    Object.assign(page, { path: "common/other.yaml", _yaml: "b: 2\n" });
    const second = page._save();
    finish();

    expect(await second).toBe(false);
    await first;
    expect(updateConfig).toHaveBeenCalledTimes(1);
  });

  test("edits typed during the save keep the leave guard from leaving", async () => {
    let finish!: () => void;
    const page = makePage({ _yaml: "a: 1\n" });
    page._api = {
      updateConfig: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
      getFileUsage: vi.fn().mockResolvedValue({ used_by: [], unknown: [] }),
    } as unknown as ESPHomeAPI;

    const saved = page._save();
    page._yaml = "a: 2\n";
    finish();

    expect(await saved).toBe(false);
    expect(page._savedYaml).toBe("a: 1\n");
  });

  test("Reload from a conflict toast is ignored once another file is open", async () => {
    const page = makePage({ _yaml: "new: 1\n" });
    page._api = {
      updateConfig: vi
        .fn()
        .mockRejectedValue(new APIError("precondition_failed", "differs")),
    } as unknown as ESPHomeAPI;
    await page._save();
    const start = vi.spyOn(page._load as unknown as { start(): void }, "start");

    page.path = "common/other.yaml";
    lastToastOptions(toast.error).action!.onClick();

    expect(start).not.toHaveBeenCalled();
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

    await page._announceSaved("common/base.yaml");

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

    await page._announceSaved("common/base.yaml");

    expect(vi.mocked(toast.success).mock.lastCall?.[0]).toBe("file.saved");
    expect(lastToastOptions(toast.success).action).toBeUndefined();
  });
});

describe("esphome-page-file delete", () => {
  test("hands the current path to the delete dialog", () => {
    const open = vi.fn();
    const page = makePage();
    // ``@query`` installs a getter; shadow it on the instance.
    Object.defineProperty(page, "_deleteDialog", { value: { open } });

    page._confirmDelete();

    expect(open).toHaveBeenCalledWith("common/base.yaml");
  });

  test("after the delete, returns to the packages list without a save prompt", () => {
    const page = makePage({ _yaml: "unsaved: 1\n" });

    page._onDeleted(
      new CustomEvent("file-deleted", { detail: { path: "common/base.yaml" } })
    );

    expect(page._savedYaml).toBe(page._yaml);
    expect(navigate).toHaveBeenCalledWith("/packages");
  });

  test("a delete of a file no longer open leaves this one alone", () => {
    const page = makePage({ _yaml: "unsaved: 1\n" });

    page._onDeleted(
      new CustomEvent("file-deleted", { detail: { path: "common/old.yaml" } })
    );

    expect(page._savedYaml).toBe("logger:\n");
    expect(navigate).not.toHaveBeenCalled();
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
    // a discarded edit of a.yaml must not survive into b.yaml
    (page as unknown as PageView)._yaml = "edited: 1\n";
    page.path = "common/b.yaml";
    await page.updateComplete;
    expect((page as unknown as PageView)._yaml).toBe("");
    await flushMicrotasks(8);

    expect(getConfig.mock.calls.map((c) => c[0])).toEqual([
      "common/a.yaml",
      "common/b.yaml",
    ]);
    page.remove();
  });
});

describe("esphome-page-file section navigator", () => {
  interface NavView extends PageView {
    _navCollapsed: boolean;
    _highlight: { fromLine: number; toLine: number } | null;
    _scrollToHighlight: boolean;
    _selectedSection: string | null;
    _onYamlHighlight(e: CustomEvent): void;
    _onSectionSelect(e: CustomEvent): void;
    _onYamlChange(e: CustomEvent): void;
  }

  test("renders a read-only navigator next to a completion-enabled editor", () => {
    const tree = makePage().render();
    const nav = findTemplatesByAnchor(tree, "<esphome-device-navigator");
    expect(nav).toHaveLength(1);
    expect(nav[0].strings.join("")).toContain("readonly");
    const editor = findTemplatesByAnchor(tree, "<esphome-yaml-editor");
    expect(editor[0].strings.join("")).toContain("completion");
  });

  test("collapsing hides the navigator and offers a way back", () => {
    const page = makePage() as unknown as NavView;
    page._navCollapsed = true;
    const tree = page.render();
    expect(findTemplatesByAnchor(tree, "<esphome-device-navigator")).toHaveLength(0);
    expect(findTemplatesByAnchor(tree, 'name="menu"')).toHaveLength(1);
  });

  test("no navigator until the file has loaded", () => {
    const page = makePage();
    page._load.state = "loading";
    expect(
      findTemplatesByAnchor(page.render(), "<esphome-device-navigator")
    ).toHaveLength(0);
  });

  test("a section click highlights its YAML; a hand edit drops the highlight", () => {
    const page = makePage() as unknown as NavView;
    page._onSectionSelect(
      new CustomEvent("section-select", { detail: { sectionKey: "sensor", fromLine: 5 } })
    );
    page._onYamlHighlight(
      new CustomEvent("yaml-highlight", {
        detail: { range: { fromLine: 5, toLine: 9 }, scroll: true },
      })
    );
    expect(page._selectedSection).toBe("sensor");
    expect(page._highlight).toEqual({ fromLine: 5, toLine: 9 });
    expect(page._scrollToHighlight).toBe(true);

    page._onYamlChange(new CustomEvent("yaml-change", { detail: { value: "x: 1\n" } }));
    expect(page._highlight).toBeNull();
  });
});

describe("esphome-page-file rename", () => {
  interface RenameView extends PageView {
    _rename(e: CustomEvent): Promise<void>;
  }
  const renameButton = (tree: unknown) =>
    findTemplatesByAnchor(tree, 'name="rename-outline"').length;

  test("offered for a package only, and blocked while there are unsaved edits", () => {
    expect(renameButton(makePage().render())).toBe(1);
    expect(renameButton(makePage({ path: "_shared.yaml" }).render())).toBe(0);
    const dirty = makePage({ _yaml: "changed: 1\n" }).render();
    const [header] = findTemplatesByAnchor(dirty, 'name="rename-outline"');
    expect(header.strings.join("")).toContain("?disabled=");
    expect(header.values).toContain(true);
  });

  test("a successful rename opens the moved file", async () => {
    const page = makePage() as unknown as RenameView;
    Object.defineProperty(page, "isConnected", { value: true });
    page._api = {
      renameFile: vi
        .fn()
        .mockResolvedValue({ path: "shared/base.yaml", rewritten: [], unresolved: [] }),
    } as unknown as ESPHomeAPI;

    await page._rename(
      new CustomEvent("rename-file", {
        detail: { path: "common/base.yaml", newPath: "shared/base.yaml" },
      })
    );

    expect(navigate).toHaveBeenCalledWith("/file/shared/base.yaml");
  });

  test.each([
    ["the page is gone", false, "common/base.yaml"],
    ["another file is open", true, "common/other.yaml"],
  ])("a rename finishing after %s doesn't navigate", async (_, connected, current) => {
    const page = makePage({ path: current }) as unknown as RenameView;
    Object.defineProperty(page, "isConnected", { value: connected });
    page._api = {
      renameFile: vi
        .fn()
        .mockResolvedValue({ path: "common/main.yaml", rewritten: [], unresolved: [] }),
    } as unknown as ESPHomeAPI;

    await page._rename(
      new CustomEvent("rename-file", {
        detail: { path: "common/base.yaml", newPath: "common/main.yaml" },
      })
    );

    expect(navigate).not.toHaveBeenCalled();
  });

  test("a failed rename stays put", async () => {
    const page = makePage() as unknown as RenameView;
    page._api = {
      renameFile: vi.fn().mockRejectedValue(new APIError("already_exists", "taken")),
    } as unknown as ESPHomeAPI;

    await page._rename(
      new CustomEvent("rename-file", {
        detail: { path: "common/base.yaml", newPath: "common/wifi.yaml" },
      })
    );

    expect(navigate).not.toHaveBeenCalled();
  });
});
