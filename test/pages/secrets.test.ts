// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import toast from "sonner-js";

import { APIError } from "../../src/api/api-error.js";
import type { ESPHomeAPI } from "../../src/api/index.js";
import { ESPHomePageSecrets } from "../../src/pages/secrets.js";
import {
  extractAttributeBindings,
  findTemplatesByAnchor,
} from "../_lit-template-walker.js";

vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

/**
 * Pin the secrets-page data-loss guards: don't render an editor
 * with empty content while loading, and keep Save disabled when
 * the buffer is empty.
 */

interface PageView {
  _loaded: boolean;
  _yaml: string;
  _savedYaml: string;
  _saving: boolean;
  _api: ESPHomeAPI;
  _layout: "form" | "split" | "yaml";
  _narrow: boolean;
  readonly _effectiveLayout: "form" | "split" | "yaml";
  _readStoredLayout(): "form" | "split" | "yaml";
  _setLayout(layout: "form" | "split" | "yaml"): void;
  _onYamlChange(e: CustomEvent<{ value: string }>): void;
  _confirmLeave(): Promise<boolean>;
  _onUnsavedSave(): void;
  _onUnsavedDiscard(): void;
  _onUnsavedCancel(): void;
  _save(): Promise<boolean>;
  render(): unknown;
}

function makePage(overrides: Partial<PageView> = {}): PageView {
  const page = new ESPHomePageSecrets() as unknown as PageView;
  page._loaded = false;
  page._yaml = "";
  page._savedYaml = "";
  page._saving = false;
  Object.assign(page, overrides);
  return page;
}

describe("esphome-page-secrets editor gating", () => {
  test("while loading: spinner is rendered, no editor, no save button", () => {
    const tree = makePage({ _loaded: false }).render();
    expect(findTemplatesByAnchor(tree, "<wa-spinner")).toHaveLength(1);
    expect(findTemplatesByAnchor(tree, "<esphome-yaml-editor")).toHaveLength(0);
    expect(findTemplatesByAnchor(tree, 'class="save-button"')).toHaveLength(0);
  });

  test("after load: editor is rendered with the loaded buffer, spinner gone", () => {
    const tree = makePage({
      _loaded: true,
      _yaml: "wifi_password: hunter2\n",
      _savedYaml: "wifi_password: hunter2\n",
    }).render();
    expect(findTemplatesByAnchor(tree, "<wa-spinner")).toHaveLength(0);
    const editors = findTemplatesByAnchor(tree, "<esphome-yaml-editor");
    expect(editors).toHaveLength(1);
    expect(extractAttributeBindings(editors[0])[".value"]).toBe(
      "wifi_password: hunter2\n"
    );
  });
});

describe("esphome-page-secrets save-button disabled state", () => {
  function saveDisabled(page: PageView): unknown {
    const buttons = findTemplatesByAnchor(page.render(), 'class="save-button"');
    expect(buttons).toHaveLength(1);
    return extractAttributeBindings(buttons[0])["?disabled"];
  }

  test("disabled when buffer equals saved (no dirty state)", () => {
    const yaml = "wifi_password: hunter2\n";
    expect(saveDisabled(makePage({ _loaded: true, _yaml: yaml, _savedYaml: yaml }))).toBe(
      true
    );
  });

  test("enabled when buffer differs from saved AND is non-empty", () => {
    expect(
      saveDisabled(
        makePage({
          _loaded: true,
          _yaml: "wifi_password: new\n",
          _savedYaml: "wifi_password: old\n",
        })
      )
    ).toBe(false);
  });

  test("disabled when buffer is empty even though it differs from saved", () => {
    expect(
      saveDisabled(
        makePage({
          _loaded: true,
          _yaml: "",
          _savedYaml: "wifi_password: hunter2\n",
        })
      )
    ).toBe(true);
  });

  test("disabled when buffer is whitespace-only even though it differs from saved", () => {
    expect(
      saveDisabled(
        makePage({
          _loaded: true,
          _yaml: "   \n\t\n",
          _savedYaml: "wifi_password: hunter2\n",
        })
      )
    ).toBe(true);
  });

  test("_save() flips _saving true during the in-flight call and false after", async () => {
    let resolveUpdate!: () => void;
    const updateConfigPromise = new Promise<void>((r) => {
      resolveUpdate = r;
    });
    const page = makePage({
      _loaded: true,
      _yaml: "wifi_password: new\n",
      _savedYaml: "wifi_password: old\n",
    });
    page._api = {
      updateConfig: vi.fn().mockReturnValue(updateConfigPromise),
    } as unknown as ESPHomeAPI;

    expect(page._saving).toBe(false);
    const savePromise = page._save();
    // In-flight: _saving is true and the rendered button reflects that.
    expect(page._saving).toBe(true);
    expect(saveDisabled(page)).toBe(true);

    resolveUpdate();
    await savePromise;

    expect(page._saving).toBe(false);
    // Post-success: dirty-check disables (yaml === savedYaml now).
    expect(saveDisabled(page)).toBe(true);
  });
});

describe("esphome-page-secrets save toast ordering", () => {
  test("_save() does not flash a success toast when the backend rejects the write", async () => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    const page = makePage({
      _loaded: true,
      _yaml: "wifi_password: new\n",
      _savedYaml: "wifi_password: old\n",
    });
    page._api = {
      updateConfig: vi.fn().mockRejectedValue(new Error("invalid secrets")),
    } as unknown as ESPHomeAPI;

    await page._save();

    // A real failure surfaces one error toast and no success toast,
    // and rolls the buffer back so the dirty indicator returns.
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(page._savedYaml).toBe("wifi_password: old\n");
  });

  test("_save() surfaces the backend rejection detail without the error_code prefix", async () => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    const page = makePage({
      _loaded: true,
      _yaml: "wifi_ssid: home\nxx:xxx\n",
      _savedYaml: "wifi_ssid: old\n",
    });
    const detail =
      "refusing to save invalid secrets.yaml: could not find expected ':' at line 2, column 1";
    // Real updateConfig() failures are APIError, whose user-facing text
    // lives in .details while .message carries the internal error_code.
    page._api = {
      updateConfig: vi.fn().mockRejectedValue(new APIError("invalid_request", detail)),
    } as unknown as ESPHomeAPI;

    await page._save();

    expect(toast.error).toHaveBeenCalledTimes(1);
    const [message] = vi.mocked(toast.error).mock.calls[0];
    expect(message).toContain(detail);
    expect(message).not.toContain("invalid_request");
  });

  test("_save() toasts success and fires secrets-saved only after the write resolves", async () => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    let resolveUpdate!: () => void;
    const page = makePage({
      _loaded: true,
      _yaml: "wifi_password: new\n",
      _savedYaml: "wifi_password: old\n",
    });
    page._api = {
      updateConfig: vi.fn().mockReturnValue(
        new Promise<void>((r) => {
          resolveUpdate = r;
        })
      ),
    } as unknown as ESPHomeAPI;
    const onSaved = vi.fn();
    window.addEventListener("secrets-saved", onSaved);

    const savePromise = page._save();
    // The write is still in flight: nothing has been toasted and no
    // listener notified yet. A deferred promise pins the ordering an
    // immediately-resolved mock can't — an optimistic toast fired
    // before the await would show up here and fail the test.
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();

    resolveUpdate();
    await savePromise;
    window.removeEventListener("secrets-saved", onSaved);

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test("_save() treats a WS timeout as success and keeps the buffer", async () => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    const page = makePage({
      _loaded: true,
      _yaml: "wifi_password: new\n",
      _savedYaml: "wifi_password: old\n",
    });
    page._api = {
      updateConfig: vi.fn().mockRejectedValue(new Error("command timed out")),
    } as unknown as ESPHomeAPI;

    await page._save();

    // A timeout probably still wrote the file: keep the buffer and
    // show success rather than claiming failure.
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(page._savedYaml).toBe("wifi_password: new\n");
  });

  test("_save() fires secrets-saved on the timeout-as-success path", async () => {
    const page = makePage({
      _loaded: true,
      _yaml: "wifi_password: new\n",
      _savedYaml: "wifi_password: old\n",
    });
    page._api = {
      updateConfig: vi.fn().mockRejectedValue(new Error("command timed out")),
    } as unknown as ESPHomeAPI;
    const onSaved = vi.fn();
    window.addEventListener("secrets-saved", onSaved);

    await page._save();
    window.removeEventListener("secrets-saved", onSaved);

    // A timeout is treated as success, so listeners (onboarding-state
    // refresh, peer secrets pages) must be notified too; otherwise
    // the UI claims success while they stay stale.
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test("_save() does not fire secrets-saved on a real failure", async () => {
    const page = makePage({
      _loaded: true,
      _yaml: "wifi_password: new\n",
      _savedYaml: "wifi_password: old\n",
    });
    page._api = {
      updateConfig: vi.fn().mockRejectedValue(new Error("invalid secrets")),
    } as unknown as ESPHomeAPI;
    const onSaved = vi.fn();
    window.addEventListener("secrets-saved", onSaved);

    await page._save();
    window.removeEventListener("secrets-saved", onSaved);

    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("esphome-page-secrets layout persistence", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  test("defaults to the structured form when nothing is stored", () => {
    expect(makePage()._readStoredLayout()).toBe("form");
  });

  test("falls back to form for an unrecognized stored value", () => {
    localStorage.setItem("esphome-secrets-layout", "bogus");
    expect(makePage()._readStoredLayout()).toBe("form");
  });

  test("reads a stored valid layout", () => {
    localStorage.setItem("esphome-secrets-layout", "split");
    expect(makePage()._readStoredLayout()).toBe("split");
  });

  test("_setLayout updates state and persists the choice", () => {
    const page = makePage();
    page._setLayout("yaml");
    expect(page._layout).toBe("yaml");
    expect(localStorage.getItem("esphome-secrets-layout")).toBe("yaml");
  });

  test("a persisted split layout presents as the form below the breakpoint", () => {
    const page = makePage({ _layout: "split", _narrow: true });
    expect(page._effectiveLayout).toBe("form");
  });

  test("split stays split above the breakpoint", () => {
    const page = makePage({ _layout: "split", _narrow: false });
    expect(page._effectiveLayout).toBe("split");
  });

  test("both panes bind the same buffer and either change advances it", () => {
    const page = makePage({
      _loaded: true,
      _layout: "split",
      _yaml: "wifi_ssid: home\n",
    });
    const editors = findTemplatesByAnchor(
      page.render(),
      "<esphome-secrets-structured-editor"
    );
    const yaml = findTemplatesByAnchor(page.render(), "<esphome-yaml-editor");
    expect(editors).toHaveLength(1);
    expect(yaml).toHaveLength(1);
    expect(extractAttributeBindings(editors[0])[".value"]).toBe("wifi_ssid: home\n");
    expect(extractAttributeBindings(yaml[0])[".value"]).toBe("wifi_ssid: home\n");

    page._onYamlChange(
      new CustomEvent("yaml-change", { detail: { value: "wifi_ssid: office\n" } })
    );
    expect(page._yaml).toBe("wifi_ssid: office\n");
  });
});

describe("esphome-page-secrets unsaved-changes leave guard", () => {
  function dirtyPage(): PageView {
    return makePage({
      _loaded: true,
      _yaml: "wifi_ssid: new\n",
      _savedYaml: "wifi_ssid: old\n",
    });
  }

  test("a clean buffer leaves immediately without prompting", async () => {
    const page = makePage({ _loaded: true, _yaml: "a: 1\n", _savedYaml: "a: 1\n" });
    expect(await page._confirmLeave()).toBe(true);
  });

  test("Discard leaves without saving", async () => {
    const page = dirtyPage();
    page._api = { updateConfig: vi.fn() } as unknown as ESPHomeAPI;
    const leaving = page._confirmLeave();
    page._onUnsavedDiscard();
    expect(await leaving).toBe(true);
    expect(page._api.updateConfig).not.toHaveBeenCalled();
  });

  test("Cancel blocks navigation", async () => {
    const page = dirtyPage();
    const leaving = page._confirmLeave();
    page._onUnsavedCancel();
    expect(await leaving).toBe(false);
  });

  test("Save persists and then leaves", async () => {
    const page = dirtyPage();
    page._api = {
      updateConfig: vi.fn().mockResolvedValue(undefined),
    } as unknown as ESPHomeAPI;
    const leaving = page._confirmLeave();
    page._onUnsavedSave();
    expect(await leaving).toBe(true);
    expect(page._api.updateConfig).toHaveBeenCalledWith(
      "secrets.yaml",
      "wifi_ssid: new\n"
    );
  });

  test("a failed Save keeps the user on the page", async () => {
    const page = dirtyPage();
    page._api = {
      updateConfig: vi.fn().mockRejectedValue(new Error("invalid secrets")),
    } as unknown as ESPHomeAPI;
    const leaving = page._confirmLeave();
    page._onUnsavedSave();
    expect(await leaving).toBe(false);
  });
});
