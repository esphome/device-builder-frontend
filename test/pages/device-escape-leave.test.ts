// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import "./_mock-device-children.js";

import toast from "sonner-js";

import { ESPHomePageDevice } from "../../src/pages/device.js";
import { setLeaveGuard } from "../../src/util/navigation.js";

/**
 * Pin the Escape-to-leave path against esphome/device-builder#2259: with a
 * dirty buffer, Escape must run the unsaved-changes guard BEFORE popping
 * history. The old raw ``history.back()`` lost the buffer to the router's
 * popstate listener in the pre-interceptor era; prompting first also shows
 * the dialog while the URL still names the page.
 */

interface EscapeView {
  id: string;
  _yaml: string;
  _savedYaml: string;
  _sectionDirty: boolean;
  _saveYaml(): Promise<boolean>;
  _onUnsavedSave(): void;
  _drawerOpen: boolean;
  _saving: boolean;
  _pendingValidationResolve: ((saved: boolean) => void) | null;
  _activeSection: {
    dirty: boolean;
    lastFlushFailed: boolean;
    flushPending: () => void | Promise<void>;
    reload: () => void;
  } | null;
  _onKeydown(e: KeyboardEvent): void;
  _onBeforeUnload(e: BeforeUnloadEvent): void;
  _leaveGuard: { handlePopState(e: PopStateEvent): void };
  _onUnsavedDiscard(): void;
  _onUnsavedCancel(): void;
  _confirmLeave(): Promise<boolean>;
}

function makePage(): { page: EscapeView; dialogOpen: ReturnType<typeof vi.fn> } {
  const page = new ESPHomePageDevice() as unknown as EscapeView;
  page.id = "kitchen";
  page._yaml = "esphome:\n  name: kitchen\n  friendly_name: edited\n";
  page._savedYaml = "esphome:\n  name: kitchen\n";
  const dialogOpen = vi.fn();
  // ``_unsavedDialog`` is a @query getter on the prototype; shadow it so the
  // guard's ``open`` lands on the spy without mounting the component tree.
  Object.defineProperty(page, "_unsavedDialog", { value: { open: dialogOpen } });
  // Register the raw confirm as the leave guard — production registers
  // the controller's wrapped guard, but these cells only exercise the
  // confirm flow, not the allow-flag handshake.
  setLeaveGuard(page._confirmLeave);
  return { page, dialogOpen };
}

function escapeEvent(
  target: EventTarget = document.body,
  defaultPrevented = false
): KeyboardEvent {
  return {
    key: "Escape",
    defaultPrevented,
    preventDefault: vi.fn(),
    composedPath: () => [target],
  } as unknown as KeyboardEvent;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("esphome-page-device Escape leave guard", () => {
  let backSpy: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    // A non-null object history.state marks an in-SPA history entry, the
    // shape ``navigate()`` pushes — the branch that pops history.
    window.history.pushState({}, "", "/device/kitchen");
    backSpy = vi.fn<() => void>();
    vi.spyOn(window.history, "back").mockImplementation(backSpy);
  });

  afterEach(() => {
    setLeaveGuard(null);
    vi.restoreAllMocks();
  });

  test("dirty buffer: Escape opens the prompt and holds the navigation", async () => {
    const { page, dialogOpen } = makePage();
    const ev = escapeEvent();

    page._onKeydown(ev);
    await flush();

    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    expect(dialogOpen).toHaveBeenCalledTimes(1);
    expect(backSpy).not.toHaveBeenCalled();

    page._onUnsavedDiscard();
    await flush();
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  test("Cancel keeps the page: no history pop", async () => {
    const { page, dialogOpen } = makePage();

    page._onKeydown(escapeEvent());
    await flush();
    expect(dialogOpen).toHaveBeenCalledTimes(1);

    page._onUnsavedCancel();
    await flush();
    expect(backSpy).not.toHaveBeenCalled();
  });

  test("clean buffer: Escape leaves immediately without the prompt", async () => {
    const { page, dialogOpen } = makePage();
    page._savedYaml = page._yaml;

    page._onKeydown(escapeEvent());
    await flush();

    expect(dialogOpen).not.toHaveBeenCalled();
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  test("Escape in a typing target is left to the editor", async () => {
    const { page, dialogOpen } = makePage();
    const ev = escapeEvent(document.createElement("input"));

    page._onKeydown(ev);
    await flush();

    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(dialogOpen).not.toHaveBeenCalled();
    expect(backSpy).not.toHaveBeenCalled();
  });

  test("an Escape a deeper handler already claimed is ignored", async () => {
    const { page, dialogOpen } = makePage();

    page._onKeydown(escapeEvent(document.body, true));
    await flush();

    expect(dialogOpen).not.toHaveBeenCalled();
    expect(backSpy).not.toHaveBeenCalled();
  });

  test("Escape closes the drawer before it means leave", async () => {
    const { page, dialogOpen } = makePage();
    page._drawerOpen = true;

    page._onKeydown(escapeEvent());
    await flush();

    expect(page._drawerOpen).toBe(false);
    expect(dialogOpen).not.toHaveBeenCalled();
    expect(backSpy).not.toHaveBeenCalled();
  });
});

describe("leave guard flush ordering (#1503)", () => {
  afterEach(() => {
    setLeaveGuard(null);
    vi.mocked(toast.error).mockClear();
  });

  /** A section whose flush settles a round: clears the transient
   *  dirty flag and reports whether the round landed. */
  function settlingSection(page: EscapeView, opts: { failed: boolean }) {
    const section = {
      dirty: true,
      lastFlushFailed: false,
      flushPending: async () => {
        page._sectionDirty = false;
        section.lastFlushFailed = opts.failed;
      },
      reload: () => {},
    };
    return section;
  }

  test("the dialog runs only after the automation editor's flush settles", async () => {
    const { page, dialogOpen } = makePage();
    const order: string[] = [];
    let settle!: () => void;
    page._activeSection = {
      dirty: true,
      lastFlushFailed: false,
      flushPending: () =>
        new Promise<void>((resolve) => {
          settle = () => {
            order.push("flushed");
            resolve();
          };
        }),
      reload: () => {},
    };
    dialogOpen.mockImplementation(() => order.push("dialog"));

    const leaving = page._confirmLeave();
    // The dialog must not open against a pre-flush buffer.
    await Promise.resolve();
    expect(order).toEqual([]);

    settle();
    await flush();
    expect(order[0]).toBe("flushed");
    expect(order).toContain("dialog");

    // Settle the guard so the promise resolves.
    page._onUnsavedDiscard();
    await leaving;
  });

  test("a failed round that clears the transient flag still prompts", async () => {
    const { page, dialogOpen } = makePage();
    // Otherwise-clean buffer: the only pending change is the edit
    // inside the debounce window, represented by _sectionDirty.
    page._savedYaml = page._yaml;
    page._sectionDirty = true;
    // The engine settles a FAILED round by clearing the dirty flag
    // without landing a draft (its own catch already toasted); it
    // reports that through lastFlushFailed, which the leave
    // decision reads instead of failing open.
    page._activeSection = settlingSection(page, { failed: true });

    const leaving = page._confirmLeave();
    await flush();

    expect(dialogOpen).toHaveBeenCalledTimes(1);
    page._onUnsavedDiscard();
    await leaving;
  });

  test("a no-op flush leaves silently, exactly as before (#1503)", async () => {
    const { page, dialogOpen } = makePage();
    // The user typed and undid a keystroke inside the debounce
    // window: the round settles clean with nothing to land. That
    // must not prompt — there is genuinely nothing unsaved.
    page._savedYaml = page._yaml;
    page._sectionDirty = true;
    page._activeSection = settlingSection(page, { failed: false });

    expect(await page._confirmLeave()).toBe(true);
    expect(dialogOpen).not.toHaveBeenCalled();
  });

  test("Save on the failed-round path stays put and says why", async () => {
    const { page, dialogOpen } = makePage();
    page._savedYaml = page._yaml;
    page._sectionDirty = true;
    page._activeSection = settlingSection(page, { failed: true });
    const saveYaml = vi.fn(async () => true);
    page._saveYaml = saveYaml;

    const leaving = page._confirmLeave();
    await flush();
    expect(dialogOpen).toHaveBeenCalledTimes(1);

    // The user picked "keep my work". _saveYaml cannot re-run the
    // settled failed round, so "Save and leave" must stay put
    // rather than discard the edit it claimed to keep — and toast,
    // or the refusal reads as a dead button.
    page._onUnsavedSave();
    expect(await leaving).toBe(false);
    expect(saveYaml).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  test("Save leaves normally when the save actually writes", async () => {
    const { page, dialogOpen } = makePage();
    page._sectionDirty = true;
    page._activeSection = settlingSection(page, { failed: false });
    page._saveYaml = vi.fn(async () => {
      page._savedYaml = page._yaml;
      return true;
    });

    const leaving = page._confirmLeave();
    await flush();
    expect(dialogOpen).toHaveBeenCalledTimes(1);

    page._onUnsavedSave();
    expect(await leaving).toBe(true);
  });

  test("a rejecting flush still runs the guard, with the cause logged", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { page, dialogOpen } = makePage();
      page._activeSection = {
        dirty: true,
        lastFlushFailed: false,
        flushPending: () => Promise.reject(new Error("upsert failed")),
        reload: () => {},
      };

      const leaving = page._confirmLeave();
      await flush();

      // The editor already surfaced its own failure; the guard still
      // runs with the freshest available state.
      expect(dialogOpen).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalled();

      page._onUnsavedDiscard();
      await leaving;
    } finally {
      consoleError.mockRestore();
    }
  });

  test("Save leaves after a one-off flush throw when the retry lands", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { page, dialogOpen } = makePage();
      // Buffer clean; only the throw backstop arms the prompt.
      page._savedYaml = page._yaml;
      page._activeSection = {
        dirty: true,
        lastFlushFailed: false,
        flushPending: () => Promise.reject(new Error("transient")),
        reload: () => {},
      };
      // ``_saveYaml`` re-runs the flush for real; a one-off throw
      // that its retry survives leaves nothing stranded, so Save
      // must leave rather than dead-end on the sticky backstop.
      page._saveYaml = vi.fn(async () => true);

      const leaving = page._confirmLeave();
      await flush();
      expect(dialogOpen).toHaveBeenCalledTimes(1);

      page._onUnsavedSave();
      expect(await leaving).toBe(true);
      expect(toast.error).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  test("an armed validation prompt keeps the busy borrow off", async () => {
    const { page } = makePage();
    // The validation dialog is open: _saving is false but the
    // resolver is armed. The leave flush must not borrow the flag —
    // its finally would clear a "Save anyway" write's re-entrancy
    // lock out from under it.
    page._pendingValidationResolve = () => {};
    let settle!: () => void;
    page._activeSection = {
      dirty: true,
      lastFlushFailed: false,
      flushPending: () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
      reload: () => {},
    };

    const leaving = page._confirmLeave();
    await Promise.resolve();
    expect(page._saving).toBe(false);

    settle();
    await flush();
    page._onUnsavedCancel();
    await leaving;
    expect(page._saving).toBe(false);
  });

  test("a settled-as-failed round arms the beforeunload warning", () => {
    const { page } = makePage();
    // Buffer clean, transient flag already cleared by the settle —
    // only lastFlushFailed knows the edit never landed.
    page._savedYaml = page._yaml;
    page._sectionDirty = false;
    const section = settlingSection(page, { failed: true });
    section.lastFlushFailed = true;
    page._activeSection = section;

    const preventDefault = vi.fn();
    page._onBeforeUnload({ preventDefault } as unknown as BeforeUnloadEvent);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  test("a settled-as-failed round intercepts popstate and prompts", async () => {
    const { page, dialogOpen } = makePage();
    page._savedYaml = page._yaml;
    page._sectionDirty = false;
    const section = settlingSection(page, { failed: true });
    section.lastFlushFailed = true;
    page._activeSection = section;

    const stopImmediatePropagation = vi.fn();
    page._leaveGuard.handlePopState({
      stopImmediatePropagation,
    } as unknown as PopStateEvent);
    await flush();

    // The popped entry is held (re-pushed) and the guard runs
    // instead of the router unmounting the page over a lost edit.
    expect(stopImmediatePropagation).toHaveBeenCalledTimes(1);
    expect(dialogOpen).toHaveBeenCalledTimes(1);
    // Cancel settles the guard without a history pop.
    page._onUnsavedCancel();
  });

  test("Save leaves once a hydrate clears the latch under the open dialog", async () => {
    const { page, dialogOpen } = makePage();
    page._savedYaml = page._yaml;
    page._sectionDirty = true;
    const section = settlingSection(page, { failed: true });
    page._activeSection = section;
    page._saveYaml = vi.fn(async () => true);

    const leaving = page._confirmLeave();
    await flush();
    expect(dialogOpen).toHaveBeenCalledTimes(1);

    // A reload timer's hydrate replaced the form state and cleared
    // the latch while the dialog sat open; the refusal must read
    // the live signal, not the pre-dialog snapshot, or "Save and
    // leave" refuses over an edit that no longer exists.
    section.lastFlushFailed = false;
    page._onUnsavedSave();
    expect(await leaving).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
