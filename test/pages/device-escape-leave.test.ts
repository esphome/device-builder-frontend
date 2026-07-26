// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ESPHomePageDevice } from "../../src/pages/device.js";
import { setLeaveGuard } from "../../src/util/navigation.js";

/**
 * Pin the Escape-to-leave path against esphome/device-builder#2259: with a
 * dirty buffer, Escape must run the unsaved-changes guard BEFORE popping
 * history. The old raw ``history.back()`` lost the buffer to the router's
 * popstate listener, which unmounts the page before the device page's own
 * popstate guard can veto.
 */

interface EscapeView {
  id: string;
  _yaml: string;
  _savedYaml: string;
  _sectionDirty: boolean;
  _saveYaml(): Promise<boolean>;
  _onUnsavedSave(): void;
  _drawerOpen: boolean;
  _activeSection: {
    dirty: boolean;
    flushPending: () => void | Promise<void>;
    reload: () => void;
  } | null;
  _onKeydown(e: KeyboardEvent): void;
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
  // Mirror connectedCallback's registration — the piece of mounting the
  // Escape path actually depends on.
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
  });

  test("the dialog runs only after the automation editor's flush settles", async () => {
    const { page, dialogOpen } = makePage();
    const order: string[] = [];
    let settle!: () => void;
    page._activeSection = {
      dirty: true,
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
    await Promise.resolve();
    await Promise.resolve();
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
    page._activeSection = {
      dirty: true,
      // The engine settles a FAILED round by clearing the dirty
      // flag without landing a draft (its own catch already
      // toasted); the leave decision must not fail open on that.
      flushPending: async () => {
        page._sectionDirty = false;
      },
      reload: () => {},
    };

    const leaving = page._confirmLeave();
    await Promise.resolve();
    await Promise.resolve();

    expect(dialogOpen).toHaveBeenCalledTimes(1);
    page._onUnsavedDiscard();
    await leaving;
  });

  test("Save on the failed-round path retries through _saveYaml", async () => {
    const { page, dialogOpen } = makePage();
    page._savedYaml = page._yaml;
    page._sectionDirty = true;
    page._activeSection = {
      dirty: true,
      flushPending: async () => {
        page._sectionDirty = false;
      },
      reload: () => {},
    };
    const saveYaml = vi.fn(async () => true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (page as any)._saveYaml = saveYaml;

    const leaving = page._confirmLeave();
    await Promise.resolve();
    await Promise.resolve();
    expect(dialogOpen).toHaveBeenCalledTimes(1);

    // The user picked "keep my work": the save lambda must retry
    // through _saveYaml (whose own awaited flush re-runs the
    // upsert) instead of no-opping on the clean-looking buffer.
    page._onUnsavedSave();
    expect(await leaving).toBe(true);
    expect(saveYaml).toHaveBeenCalledTimes(1);
  });

  test("a rejecting flush still runs the guard, with the cause logged", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { page, dialogOpen } = makePage();
      page._activeSection = {
        dirty: true,
        flushPending: () => Promise.reject(new Error("upsert failed")),
        reload: () => {},
      };

      const leaving = page._confirmLeave();
      await Promise.resolve();
      await Promise.resolve();

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
});
