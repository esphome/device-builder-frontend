// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import toast from "sonner-js";

import "../_mock-webawesome.js";
import { flushMicrotasks } from "../_dom.js";
import {
  extractAttributeBindings,
  findTemplatesByAnchor,
} from "../_lit-template-walker.js";
import { APIError } from "../../src/api/api-error.js";
import type { ESPHomeAPI } from "../../src/api/index.js";
import { ESPHomePageSecrets } from "../../src/pages/secrets.js";

// The load cells below mount the page for real, which upgrades these
// children; Web Awesome's form-associated base and CodeMirror both crash
// under happy-dom, and the render-only cells only inspect tag names.
// (_mock-webawesome covers icon/spinner; button isn't in the shared set.)
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("../../src/components/confirm-dialog.js", () => ({}));
vi.mock("../../src/components/secrets/secrets-structured-editor.js", () => ({}));
vi.mock("../../src/components/unsaved-changes-dialog.js", () => ({}));
vi.mock("../../src/components/yaml-editor.js", () => ({}));

// Capture the save-shortcut callback the page wires so the gating closure
// can be exercised without mounting (and binding a real window listener).
const { capturedRef } = vi.hoisted(() => ({
  capturedRef: { onSave: undefined as (() => void) | undefined },
}));
vi.mock("../../src/util/save-shortcut-controller.js", () => ({
  SaveShortcutController: class {
    constructor(_host: unknown, onSave: () => void) {
      capturedRef.onSave = onSave;
    }
    hostConnected() {}
    hostDisconnected() {}
  },
}));

/**
 * Pin the secrets-page data-loss guards: don't render an editor
 * with empty content while loading, and keep Save disabled when
 * the buffer is empty.
 */

interface PageView {
  _load: {
    state: "loading" | "ready" | "error" | "missing";
    start(): Promise<void>;
    refresh(): Promise<void>;
  };
  _yaml: string;
  _savedYaml: string;
  _saving: boolean;
  _api: ESPHomeAPI;
  _layout: "form" | "yaml";
  _readStoredLayout(): "form" | "yaml" | null;
  _seedLayoutFromBackend(): Promise<void>;
  _setLayout(layout: "form" | "yaml"): void;
  _onYamlChange(e: CustomEvent<{ value: string }>): void;
  _confirmLeave(): Promise<boolean>;
  _onUnsavedSave(): void;
  _onUnsavedDiscard(): void;
  _onUnsavedCancel(): void;
  _confirmWipe(): Promise<boolean>;
  _settlePendingWipe: ((confirmed: boolean) => void) | null;
  disconnectedCallback(): void;
  _save(): Promise<boolean>;
  render(): unknown;
}

function makePage(
  overrides: Partial<PageView> & {
    /** Routed into the load controller's public state field. */
    _loadState?: "loading" | "ready" | "error";
  } = {}
): PageView {
  const { _loadState, ...rest } = overrides;
  const page = new ESPHomePageSecrets() as unknown as PageView;
  page._load.state = _loadState ?? "loading";
  page._yaml = "";
  page._savedYaml = "";
  page._saving = false;
  Object.assign(page, rest);
  return page;
}

describe("esphome-page-secrets editor gating", () => {
  test("while loading: spinner is rendered, no editor, no save button", () => {
    const tree = makePage({ _loadState: "loading" }).render();
    expect(findTemplatesByAnchor(tree, "<wa-spinner")).toHaveLength(1);
    expect(findTemplatesByAnchor(tree, "<esphome-yaml-editor")).toHaveLength(0);
    expect(findTemplatesByAnchor(tree, 'class="save-button"')).toHaveLength(0);
  });

  test("after load: editor is rendered with the loaded buffer, spinner gone", () => {
    const tree = makePage({
      _loadState: "ready",
      _yaml: "wifi_password: hunter2\n",
      _savedYaml: "wifi_password: hunter2\n",
    }).render();
    expect(findTemplatesByAnchor(tree, "<wa-spinner")).toHaveLength(0);
    // Default layout is "form" so the structured editor is shown.
    const editors = findTemplatesByAnchor(tree, "<esphome-secrets-structured-editor");
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
    expect(
      saveDisabled(makePage({ _loadState: "ready", _yaml: yaml, _savedYaml: yaml }))
    ).toBe(true);
  });

  test("enabled when buffer differs from saved AND is non-empty", () => {
    expect(
      saveDisabled(
        makePage({
          _loadState: "ready",
          _yaml: "wifi_password: new\n",
          _savedYaml: "wifi_password: old\n",
        })
      )
    ).toBe(false);
  });

  test("enabled when buffer is empty so clearing all secrets can be confirmed", () => {
    // Save must stay enabled at zero secrets; _save() routes the empty buffer
    // through the destructive wipe-confirm dialog (#1568).
    expect(
      saveDisabled(
        makePage({
          _loadState: "ready",
          _yaml: "",
          _savedYaml: "wifi_password: hunter2\n",
        })
      )
    ).toBe(false);
  });

  test("enabled when buffer is whitespace-only and differs from saved", () => {
    expect(
      saveDisabled(
        makePage({
          _loadState: "ready",
          _yaml: "   \n\n",
          _savedYaml: "wifi_password: hunter2\n",
        })
      )
    ).toBe(false);
  });

  test("_save() flips _saving true during the in-flight call and false after", async () => {
    let resolveUpdate!: () => void;
    const updateConfigPromise = new Promise<void>((r) => {
      resolveUpdate = r;
    });
    const page = makePage({
      _loadState: "ready",
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

describe("esphome-page-secrets clear-all wipe confirm (#1568)", () => {
  test("_save() clearing every secret confirms, then sends allow_wipe", async () => {
    const updateConfig = vi.fn().mockResolvedValue(undefined);
    const page = makePage({
      _loadState: "ready",
      _yaml: "",
      _savedYaml: "wifi_password: hunter2\n",
    });
    page._api = { updateConfig } as unknown as ESPHomeAPI;
    const confirmWipe = vi.fn().mockResolvedValue(true);
    page._confirmWipe = confirmWipe;

    const ok = await page._save();

    expect(confirmWipe).toHaveBeenCalledTimes(1);
    expect(updateConfig).toHaveBeenCalledWith("secrets.yaml", "", { allowWipe: true });
    expect(ok).toBe(true);
  });

  test("_save() cancelled wipe writes nothing and keeps the saved buffer", async () => {
    const updateConfig = vi.fn().mockResolvedValue(undefined);
    const page = makePage({
      _loadState: "ready",
      _yaml: "",
      _savedYaml: "wifi_password: hunter2\n",
    });
    page._api = { updateConfig } as unknown as ESPHomeAPI;
    page._confirmWipe = vi.fn().mockResolvedValue(false);

    const ok = await page._save();

    expect(updateConfig).not.toHaveBeenCalled();
    expect(ok).toBe(false);
    // The optimistic dirty-flip never ran, so the buffer is unchanged.
    expect(page._savedYaml).toBe("wifi_password: hunter2\n");
  });

  test("_save() with secrets remaining does not confirm and omits allow_wipe", async () => {
    const updateConfig = vi.fn().mockResolvedValue(undefined);
    const page = makePage({
      _loadState: "ready",
      _yaml: "wifi_password: new\n",
      _savedYaml: "wifi_password: old\n",
    });
    page._api = { updateConfig } as unknown as ESPHomeAPI;
    const confirmWipe = vi.fn().mockResolvedValue(true);
    page._confirmWipe = confirmWipe;

    await page._save();

    expect(confirmWipe).not.toHaveBeenCalled();
    expect(updateConfig).toHaveBeenCalledWith("secrets.yaml", "wifi_password: new\n");
  });

  test("_save() editing an already-entry-less file does not confirm or send allow_wipe", async () => {
    const updateConfig = vi.fn().mockResolvedValue(undefined);
    const page = makePage({
      _loadState: "ready",
      _yaml: "# new comment\n",
      _savedYaml: "# old comment\n",
    });
    page._api = { updateConfig } as unknown as ESPHomeAPI;
    const confirmWipe = vi.fn().mockResolvedValue(true);
    page._confirmWipe = confirmWipe;

    await page._save();

    // No secrets existed before, so nothing is being cleared — no destructive
    // prompt, and a comment-only file doesn't need the backend's wipe gate.
    expect(confirmWipe).not.toHaveBeenCalled();
    expect(updateConfig).toHaveBeenCalledWith("secrets.yaml", "# new comment\n");
  });

  test("_save() blanking an already-entry-less file sends allow_wipe without confirming", async () => {
    const updateConfig = vi.fn().mockResolvedValue(undefined);
    const page = makePage({
      _loadState: "ready",
      _yaml: "",
      _savedYaml: "# only a comment\n",
    });
    page._api = { updateConfig } as unknown as ESPHomeAPI;
    const confirmWipe = vi.fn().mockResolvedValue(true);
    page._confirmWipe = confirmWipe;

    await page._save();

    // Nothing to confirm (no secrets existed), but the buffer is now truly
    // blank, so the backend gate still needs allow_wipe.
    expect(confirmWipe).not.toHaveBeenCalled();
    expect(updateConfig).toHaveBeenCalledWith("secrets.yaml", "", { allowWipe: true });
  });

  test("disconnect settles an open wipe confirm as cancelled (no dangling promise)", () => {
    const page = makePage({ _loadState: "ready" });
    const settle = vi.fn();
    page._settlePendingWipe = settle;

    page.disconnectedCallback();

    expect(settle).toHaveBeenCalledWith(false);
  });
});

describe("esphome-page-secrets initial load", () => {
  // These drive the real mount path: the load aborts when the element is
  // detached, so a bare constructor never reaches the server.
  async function mountWithApi(getConfig: ReturnType<typeof vi.fn>): Promise<PageView> {
    const page = new ESPHomePageSecrets();
    (page as unknown as { _api: ESPHomeAPI })._api = {
      ready: Promise.resolve(),
      getConfig,
      getPreferences: vi.fn().mockResolvedValue({}),
    } as unknown as ESPHomeAPI;
    document.body.appendChild(page);
    await flushMicrotasks(8);
    return page as unknown as PageView;
  }

  test("seeds the header template only when the server says the file is missing", async () => {
    const page = await mountWithApi(
      vi.fn().mockRejectedValue(new APIError("not_found", "missing"))
    );

    expect(page._yaml).not.toBe("");
    expect(page._savedYaml).toBe(page._yaml);
    expect(page._load.state).toBe("ready");
  });

  test("does not template over the real file on a non-not-found server error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const page = await mountWithApi(
      vi.fn().mockRejectedValue(new APIError("internal_error", "boom"))
    );

    // An editable blank buffer here would parse to zero entries, slipping
    // past the clear-all wipe confirm on the next save.
    expect(page._yaml).toBe("");
    expect(page._savedYaml).toBe("");
    expect(page._load.state).toBe("error");
  });

  test("retries a transport failure instead of templating over the real file", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const getConfig = vi
        .fn()
        .mockRejectedValueOnce(new Error("WebSocket connection closed"))
        .mockResolvedValueOnce("wifi_password: hunter2\n");
      const page = await mountWithApi(getConfig);
      await vi.advanceTimersByTimeAsync(2000);
      await flushMicrotasks(8);

      // The real file wins; the blank template never reached the buffer.
      expect(getConfig).toHaveBeenCalledTimes(2);
      expect(page._yaml).toBe("wifi_password: hunter2\n");
      expect(page._savedYaml).toBe("wifi_password: hunter2\n");
    } finally {
      vi.useRealTimers();
    }
  });

  test("a failed background reload keeps the rendered editor and toasts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const getConfig = vi
      .fn()
      .mockResolvedValueOnce("wifi_password: hunter2\n")
      .mockRejectedValueOnce(new APIError("internal_error", "boom"));
    const page = await mountWithApi(getConfig);
    expect(page._load.state).toBe("ready");
    vi.mocked(toast.error).mockClear();

    await page._load.refresh();
    await flushMicrotasks(8);

    // The content is still in memory; demoting to the error panel would
    // hide it behind an unnecessary Retry.
    expect(page._load.state).toBe("ready");
    expect(page._yaml).toBe("wifi_password: hunter2\n");
    expect(toast.error).toHaveBeenCalled();
  });

  test("an external save landing mid-load supersedes it with a fresh read", async () => {
    let settleFirst!: (yaml: string) => void;
    const getConfig = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string>((r) => (settleFirst = r)))
      .mockResolvedValueOnce("wifi_password: fresh\n");
    const page = await mountWithApi(getConfig);

    // The wizard wrote secrets.yaml while the mount's read was in
    // flight; that reply predates the write, so a fresh read must win
    // and the stale one must be dropped even though it settles later.
    void page._load.refresh();
    settleFirst("wifi_password: stale\n");
    await flushMicrotasks(8);

    expect(getConfig).toHaveBeenCalledTimes(2);
    expect(page._yaml).toBe("wifi_password: fresh\n");
    expect(page._savedYaml).toBe("wifi_password: fresh\n");
  });

  test("re-runs a failed load when the socket comes back", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const getConfig = vi
        .fn()
        .mockRejectedValue(new Error("WebSocket connection closed"));
      const page = await mountWithApi(getConfig);
      await vi.advanceTimersByTimeAsync(1500 * 4);
      await flushMicrotasks(8);
      expect(page._load.state).toBe("error");

      getConfig.mockResolvedValueOnce("wifi_password: hunter2\n");
      (page as unknown as { _apiConnected: boolean })._apiConnected = true;
      (page as unknown as { requestUpdate(): void }).requestUpdate();
      await flushMicrotasks(8);

      expect(page._load.state).toBe("ready");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("esphome-page-secrets save toast ordering", () => {
  test("_save() does not flash a success toast when the backend rejects the write", async () => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    const page = makePage({
      _loadState: "ready",
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
      _loadState: "ready",
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
      _loadState: "ready",
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
      _loadState: "ready",
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
      _loadState: "ready",
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
      _loadState: "ready",
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

describe("esphome-page-secrets Cmd/Ctrl+S save shortcut wiring", () => {
  function pageWith(overrides: Partial<PageView>): {
    updateConfig: ReturnType<typeof vi.fn>;
    save: () => void;
  } {
    // Reset first so the assertion proves THIS construction wired the
    // shortcut, not a stale callback captured by an earlier test.
    capturedRef.onSave = undefined;
    const page = makePage({ _loadState: "ready", ...overrides });
    const updateConfig = vi.fn().mockResolvedValue(undefined);
    page._api = { updateConfig } as unknown as ESPHomeAPI;
    // The page's field initializer constructed the (mocked) controller and
    // handed us its callback — that is the gating closure the shortcut runs.
    expect(capturedRef.onSave).toBeTypeOf("function");
    return { updateConfig, save: capturedRef.onSave! };
  }

  test("saves a dirty, non-empty buffer", async () => {
    const { updateConfig, save } = pageWith({
      _yaml: "wifi_password: new\n",
      _savedYaml: "wifi_password: old\n",
    });
    save();
    await Promise.resolve();
    expect(updateConfig).toHaveBeenCalledWith("secrets.yaml", "wifi_password: new\n");
  });

  test("no-ops on a clean buffer", () => {
    const { updateConfig, save } = pageWith({
      _yaml: "wifi_password: same\n",
      _savedYaml: "wifi_password: same\n",
    });
    save();
    expect(updateConfig).not.toHaveBeenCalled();
  });

  test("no-ops while a save is already in flight", () => {
    const { updateConfig, save } = pageWith({
      _yaml: "wifi_password: new\n",
      _savedYaml: "wifi_password: old\n",
      _saving: true,
    });
    save();
    expect(updateConfig).not.toHaveBeenCalled();
  });

  test("does not trigger the destructive wipe path on an empty buffer", () => {
    // The Save button stays enabled at zero secrets to allow a confirmed wipe,
    // but the keyboard shortcut must not fire that destructive path.
    const { updateConfig, save } = pageWith({
      _yaml: "",
      _savedYaml: "wifi_password: old\n",
    });
    save();
    expect(updateConfig).not.toHaveBeenCalled();
  });
});

describe("esphome-page-secrets layout persistence", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  test("returns null when nothing is stored", () => {
    expect(makePage()._readStoredLayout()).toBeNull();
  });

  test("returns null for an unrecognized stored value", () => {
    localStorage.setItem("esphome-secrets-layout", "bogus");
    expect(makePage()._readStoredLayout()).toBeNull();
  });

  test("reads a stored valid layout", () => {
    localStorage.setItem("esphome-secrets-layout", "yaml");
    expect(makePage()._readStoredLayout()).toBe("yaml");
  });

  test("_setLayout updates state, persists locally, and writes the backend pref", () => {
    const updatePreferences = vi.fn(() => Promise.resolve());
    const page = makePage();
    page._api = { updatePreferences } as unknown as ESPHomeAPI;
    page._setLayout("yaml");
    expect(page._layout).toBe("yaml");
    expect(localStorage.getItem("esphome-secrets-layout")).toBe("yaml");
    expect(updatePreferences).toHaveBeenCalledWith({ secrets_editor_layout: "yaml" });
  });

  test("_seedLayoutFromBackend restores the layout from the backend pref", async () => {
    const getPreferences = vi.fn(() =>
      Promise.resolve({ secrets_editor_layout: "yaml" })
    );
    const page = makePage();
    page._api = { getPreferences } as unknown as ESPHomeAPI;
    await page._seedLayoutFromBackend();
    expect(page._layout).toBe("yaml");
  });

  test("_seedLayoutFromBackend defers to a layout the user toggled mid-fetch", async () => {
    // The user clicked the toggle while getPreferences() was in flight, so a
    // local choice now exists; the resolving seed must not clobber it.
    const getPreferences = vi.fn(() => {
      localStorage.setItem("esphome-secrets-layout", "form");
      return Promise.resolve({ secrets_editor_layout: "yaml" });
    });
    const page = makePage({ _layout: "form" });
    page._api = { getPreferences } as unknown as ESPHomeAPI;
    await page._seedLayoutFromBackend();
    expect(page._layout).toBe("form");
  });

  test("the active editor binds the shared buffer across a layout switch", () => {
    const page = makePage({
      _loadState: "ready",
      _layout: "form",
      _yaml: "wifi_ssid: home\n",
    });
    // In "form" layout only the structured editor renders.
    const editors = findTemplatesByAnchor(
      page.render(),
      "<esphome-secrets-structured-editor"
    );
    expect(editors).toHaveLength(1);
    expect(extractAttributeBindings(editors[0])[".value"]).toBe("wifi_ssid: home\n");

    // Switching to "yaml" layout hides the structured editor and shows the
    // yaml editor, both sharing the same _yaml buffer.
    page._layout = "yaml";
    const yaml = findTemplatesByAnchor(page.render(), "<esphome-yaml-editor");
    expect(yaml).toHaveLength(1);
    expect(
      findTemplatesByAnchor(page.render(), "<esphome-secrets-structured-editor")
    ).toHaveLength(0);
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
      _loadState: "ready",
      _yaml: "wifi_ssid: new\n",
      _savedYaml: "wifi_ssid: old\n",
    });
  }

  test("a clean buffer leaves immediately without prompting", async () => {
    const page = makePage({ _loadState: "ready", _yaml: "a: 1\n", _savedYaml: "a: 1\n" });
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
