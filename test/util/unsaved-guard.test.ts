/**
 * Tests for ``UnsavedGuard`` — the resolver/dialog-handler triplet
 * that backs the device page's two unsaved-changes prompts
 * (page-leave for the YAML buffer, section-switch for the visual
 * editor's form). Vitest's default ``node`` environment doesn't
 * give us a DOM, but the guard is pure logic so we drive it with
 * a fake "dialog" that records ``open()`` calls.
 */
import { describe, expect, it, vi } from "vitest";
import { UnsavedGuard } from "../../src/util/unsaved-guard.js";

/** Build an opener that records every call so tests can assert
 *  on dialog-pop side effects without instantiating a real
 *  ``ESPHomeUnsavedChangesDialog``. */
function makeOpener() {
  const open = vi.fn();
  return { open };
}

describe("UnsavedGuard", () => {
  it("short-circuits to true when nothing is dirty", async () => {
    const guard = new UnsavedGuard();
    const { open } = makeOpener();
    const save = vi.fn(() => Promise.resolve(true));

    const ok = await guard.run({ dirty: false, open, save });

    expect(ok).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(guard.isPending).toBe(false);
  });

  it("opens the dialog and resolves true on Discard", async () => {
    const guard = new UnsavedGuard();
    const { open } = makeOpener();
    const save = vi.fn(() => Promise.resolve(true));

    const promise = guard.run({ dirty: true, open, save });
    expect(open).toHaveBeenCalledOnce();
    expect(guard.isPending).toBe(true);

    guard.onDiscard();
    expect(await promise).toBe(true);
    // Save was *not* invoked — Discard just lets the caller
    // proceed without persisting.
    expect(save).not.toHaveBeenCalled();
    expect(guard.isPending).toBe(false);
  });

  it("runs save and resolves with the saver's success bool", async () => {
    const guard = new UnsavedGuard();
    const { open } = makeOpener();
    const save = vi.fn(() => Promise.resolve(true));

    const promise = guard.run({ dirty: true, open, save });
    await guard.onSave();

    expect(await promise).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });

  it("resolves false when save reports failure (e.g. validation error)", async () => {
    const guard = new UnsavedGuard();
    const { open } = makeOpener();
    // Mirrors ``device-section-config.save()``'s contract: the
    // save runs but ``_dirty`` stays true (validation rejected
    // the input) so the saver returns false. The page must NOT
    // proceed in that case.
    const save = vi.fn(() => Promise.resolve(false));

    const promise = guard.run({ dirty: true, open, save });
    await guard.onSave();

    expect(await promise).toBe(false);
    expect(save).toHaveBeenCalledOnce();
  });

  it("resolves false when save throws — guard never hangs", async () => {
    const guard = new UnsavedGuard();
    const { open } = makeOpener();
    // A saver that rejects (network blip, programmer bug) would
    // otherwise leave the guard's resolver dangling. ``onSave``
    // has to contain the throw and resolve the guard Promise to
    // ``false`` — otherwise the caller's ``await`` never
    // returns and ``isPending`` stays stale, blocking the
    // dialog from re-opening.
    const save = vi.fn(() => Promise.reject(new Error("boom")));

    const promise = guard.run({ dirty: true, open, save });
    await guard.onSave();

    expect(await promise).toBe(false);
    expect(guard.isPending).toBe(false);
    expect(save).toHaveBeenCalledOnce();
  });

  it("resolves false on Cancel without invoking save", async () => {
    const guard = new UnsavedGuard();
    const { open } = makeOpener();
    const save = vi.fn(() => Promise.resolve(true));

    const promise = guard.run({ dirty: true, open, save });
    guard.onCancel();

    expect(await promise).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(guard.isPending).toBe(false);
  });

  it("drops a re-entrant run while another is pending", async () => {
    const guard = new UnsavedGuard();
    const { open } = makeOpener();
    const save = vi.fn(() => Promise.resolve(true));

    const first = guard.run({ dirty: true, open, save });
    expect(open).toHaveBeenCalledTimes(1);

    // Stray cursor movement / second nav-click while the dialog
    // is already up — the second run should return false
    // immediately (don't proceed) and must not stack a second
    // dialog.
    const second = await guard.run({ dirty: true, open, save });
    expect(second).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);

    // First guard still resolves normally on user action.
    guard.onDiscard();
    expect(await first).toBe(true);
  });

  it("``cancelPending`` resolves any in-flight guard as false", async () => {
    const guard = new UnsavedGuard();
    const { open } = makeOpener();
    const save = vi.fn(() => Promise.resolve(true));

    const promise = guard.run({ dirty: true, open, save });
    expect(guard.isPending).toBe(true);

    guard.cancelPending();
    expect(await promise).toBe(false);
    expect(guard.isPending).toBe(false);
  });

  it("dialog-event handlers are no-ops when no guard is pending", async () => {
    const guard = new UnsavedGuard();
    // A late-firing dialog event (e.g. a ``wa-after-hide`` after
    // the guard already cancelled out via ``cancelPending``)
    // must not throw or resolve a stale Promise.
    expect(() => guard.onDiscard()).not.toThrow();
    expect(() => guard.onCancel()).not.toThrow();
    await expect(guard.onSave()).resolves.toBeUndefined();
  });

  it("can be reused after each round resolves", async () => {
    const guard = new UnsavedGuard();
    const { open } = makeOpener();
    const save = vi.fn(() => Promise.resolve(true));

    const first = guard.run({ dirty: true, open, save });
    guard.onDiscard();
    expect(await first).toBe(true);

    // Same instance, second round — opens the dialog a second
    // time, runs to completion as expected. Guards against a
    // bug where ``_active`` doesn't get cleared on resolve.
    const second = guard.run({ dirty: true, open, save });
    expect(open).toHaveBeenCalledTimes(2);
    guard.onCancel();
    expect(await second).toBe(false);
  });
});
