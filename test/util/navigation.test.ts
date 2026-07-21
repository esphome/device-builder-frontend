/**
 * Tests for the leave-guard navigation primitives.
 *
 * The pattern: pages with unsaved-changes state register a guard
 * via ``setLeaveGuard``; the in-app Back / logo / command-palette
 * paths all funnel through ``navigate()``, which awaits the guard
 * before pushing the new URL. The discard / save resolution races
 * with that ``await``, so the contract has to hold:
 *
 *   1. ``navigate()`` calls the registered guard exactly once
 *      before mutating history.
 *   2. ``navigate()`` short-circuits without touching history when
 *      the guard resolves ``false``.
 *   3. ``navigate()`` proceeds to ``pushState`` + dispatch a
 *      synthetic popstate when the guard resolves ``true``.
 *   4. ``setLeaveGuard(null)`` removes the guard so subsequent
 *      navigations are unconditional.
 *   5. Without any guard registered, ``navigate()`` always
 *      proceeds.
 *
 * The MasterOfNone bug (Discard does nothing on the in-app Back
 * button while the visual editor's Save left ``_isDirty=true``)
 * traced to the synthetic popstate that ``navigate()`` fires
 * being re-intercepted by the device-page's popstate guard. The
 * fix landed in ``pages/device.ts`` (``_onLeaveDiscard`` /
 * ``_onLeaveSave`` flip ``_allowingLeave=true`` before resolving),
 * but the tests here pin the underlying ``navigate`` contract so
 * a future refactor that drops the synthetic popstate or skips
 * the guard surfaces immediately.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  goBackOrHome,
  navigate,
  runLeaveGuard,
  setLeaveGuard,
} from "../../src/util/navigation.js";

/* The vitest config runs in the ``node`` environment, which has
 * no ``window``. ``navigation.ts`` reaches for ``window.history``
 * and ``window.dispatchEvent`` directly, so install a minimal
 * stub on ``globalThis`` per-test. A full DOM (jsdom / happy-dom)
 * would be overkill for this surface — the module pokes exactly
 * three globals.
 */

describe("navigate", () => {
  let pushStateSpy: ReturnType<typeof vi.fn>;
  let dispatchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    pushStateSpy = vi.fn();
    dispatchSpy = vi.fn();
    // The vitest config runs in the ``node`` environment, which has
    // no ``window``. ``navigation.ts`` reaches for ``window.history``
    // and ``window.dispatchEvent`` directly, so install a minimal
    // stub on ``globalThis`` per-test. A full DOM (jsdom / happy-dom)
    // would be overkill for this surface — the module pokes exactly
    // three globals.
    (globalThis as Record<string, unknown>).window = {
      history: { pushState: pushStateSpy },
      dispatchEvent: dispatchSpy,
    };
    // ``new PopStateEvent("popstate")`` needs a constructor — stub
    // it as ``Event`` (the test only checks the event's ``type``,
    // not popstate-specific fields).
    (globalThis as Record<string, unknown>).PopStateEvent = Event;
  });

  afterEach(() => {
    setLeaveGuard(null);
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).PopStateEvent;
    vi.restoreAllMocks();
  });

  it("pushes state and dispatches popstate when no guard is set", async () => {
    await navigate("/dashboard");

    expect(pushStateSpy).toHaveBeenCalledTimes(1);
    expect(pushStateSpy).toHaveBeenCalledWith({}, "", "/dashboard");
    const popstateCalls = dispatchSpy.mock.calls.filter(
      (call) => (call[0] as Event).type === "popstate"
    );
    expect(popstateCalls).toHaveLength(1);
  });

  it("calls the registered guard exactly once before pushing state", async () => {
    const guard = vi.fn(() => Promise.resolve(true));
    setLeaveGuard(guard);

    await navigate("/dashboard");

    expect(guard).toHaveBeenCalledTimes(1);
    // Push happens AFTER the guard resolves — pin the order so a
    // refactor that fired pushState eagerly (and only consulted
    // the guard for cancellation) can't slip through.
    expect(guard.mock.invocationCallOrder[0]).toBeLessThan(
      pushStateSpy.mock.invocationCallOrder[0]
    );
  });

  it("aborts navigation when the guard resolves false", async () => {
    const guard = vi.fn(() => Promise.resolve(false));
    setLeaveGuard(guard);

    await navigate("/dashboard");

    expect(guard).toHaveBeenCalledTimes(1);
    expect(pushStateSpy).not.toHaveBeenCalled();
    const popstateCalls = dispatchSpy.mock.calls.filter(
      (call) => (call[0] as Event).type === "popstate"
    );
    expect(popstateCalls).toHaveLength(0);
  });

  it("proceeds when the guard resolves true (Discard path)", async () => {
    // Mirrors the Discard-from-unsaved-changes-dialog flow: the
    // page's guard opens a dialog, the user clicks Discard, the
    // dialog resolves the Promise to true, and ``navigate`` then
    // pushes the new URL synchronously. The device-page popstate
    // listener is supposed to short-circuit on the synthetic
    // popstate that follows (via ``_allowingLeave``), which is
    // the bit the MasterOfNone bug missed.
    const guard = vi.fn(() => Promise.resolve(true));
    setLeaveGuard(guard);

    await navigate("/");

    expect(pushStateSpy).toHaveBeenCalledWith({}, "", "/");
    const popstateCalls = dispatchSpy.mock.calls.filter(
      (call) => (call[0] as Event).type === "popstate"
    );
    expect(popstateCalls).toHaveLength(1);
  });

  it("ignores a previously registered guard once cleared", async () => {
    const guard = vi.fn(() => Promise.resolve(false));
    setLeaveGuard(guard);
    setLeaveGuard(null);

    await navigate("/dashboard");

    expect(guard).not.toHaveBeenCalled();
    expect(pushStateSpy).toHaveBeenCalledWith({}, "", "/dashboard");
  });

  it("uses the latest registered guard when multiple are set in sequence", async () => {
    // Component lifecycle: a page mounts, registers its guard,
    // then unmounts and a new page registers its own. Pin "latest
    // wins" so a stale guard from a torn-down page can't block
    // the new page's navigations.
    const stale = vi.fn(() => Promise.resolve(false));
    const fresh = vi.fn(() => Promise.resolve(true));
    setLeaveGuard(stale);
    setLeaveGuard(fresh);

    await navigate("/");

    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(pushStateSpy).toHaveBeenCalledWith({}, "", "/");
  });

  it("awaits an asynchronous guard before pushing state", async () => {
    // The dialog-driven discard flow resolves the guard's Promise
    // *after* a microtask (user click → button handler →
    // ``_resolvePendingLeave``). Pin that ``navigate`` actually
    // awaits — without ``await activeGuard()`` it would push
    // state before the user even sees the dialog.
    let resolveGuard: ((v: boolean) => void) | undefined;
    const guard = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveGuard = resolve;
        })
    );
    setLeaveGuard(guard);

    const navPromise = navigate("/dashboard");
    // Yield once so any synchronous push would already have fired.
    await Promise.resolve();
    expect(pushStateSpy).not.toHaveBeenCalled();

    resolveGuard?.(true);
    await navPromise;

    expect(pushStateSpy).toHaveBeenCalledWith({}, "", "/dashboard");
  });
});

/**
 * ``runLeaveGuard`` is the guard-only gate for back-navigations that bypass
 * ``navigate()`` but must still honour the leave guard — the header back
 * arrow's ``history.back()``, whose raw popstate the router commits before the
 * device editor's own popstate guard can veto it. It must mirror the gating
 * half of ``navigate()`` without touching history.
 */
describe("runLeaveGuard", () => {
  afterEach(() => {
    setLeaveGuard(null);
  });

  it("resolves true when no guard is registered", async () => {
    await expect(runLeaveGuard()).resolves.toBe(true);
  });

  it("returns the guard's result (true → proceed)", async () => {
    const guard = vi.fn(() => Promise.resolve(true));
    setLeaveGuard(guard);
    await expect(runLeaveGuard()).resolves.toBe(true);
    expect(guard).toHaveBeenCalledTimes(1);
  });

  it("returns the guard's result (false → block) and calls it once", async () => {
    const guard = vi.fn(() => Promise.resolve(false));
    setLeaveGuard(guard);
    await expect(runLeaveGuard()).resolves.toBe(false);
    expect(guard).toHaveBeenCalledTimes(1);
  });

  it("awaits an asynchronous guard (dialog resolves after a microtask)", async () => {
    let resolveGuard: ((v: boolean) => void) | undefined;
    const guard = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveGuard = resolve;
        })
    );
    setLeaveGuard(guard);

    let settled: boolean | undefined;
    const p = runLeaveGuard().then((v) => (settled = v));
    await Promise.resolve();
    expect(settled).toBeUndefined(); // still pending until the user chooses

    resolveGuard?.(false);
    await p;
    expect(settled).toBe(false);
  });

  it("uses the latest registered guard and ignores a cleared one", async () => {
    const stale = vi.fn(() => Promise.resolve(false));
    setLeaveGuard(stale);
    setLeaveGuard(null);
    await expect(runLeaveGuard()).resolves.toBe(true);
    expect(stale).not.toHaveBeenCalled();
  });
});

/**
 * ``goBackOrHome`` is the shared header-back-arrow / Escape-key leave path.
 * It must run the guard BEFORE ``history.back()`` — issue
 * esphome/device-builder#2259 was Escape calling raw ``history.back()`` and
 * losing the dirty buffer to the router's popstate listener.
 */
describe("goBackOrHome", () => {
  let pushStateSpy: ReturnType<typeof vi.fn>;
  let backSpy: ReturnType<typeof vi.fn>;
  let historyState: unknown;

  const stubWindow = () => {
    (globalThis as Record<string, unknown>).window = {
      history: {
        pushState: pushStateSpy,
        back: backSpy,
        get state() {
          return historyState;
        },
      },
      dispatchEvent: vi.fn(),
    };
    (globalThis as Record<string, unknown>).PopStateEvent = Event;
  };

  beforeEach(() => {
    pushStateSpy = vi.fn();
    backSpy = vi.fn();
    historyState = {};
    stubWindow();
  });

  afterEach(() => {
    setLeaveGuard(null);
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).PopStateEvent;
    vi.restoreAllMocks();
  });

  it("runs the guard before popping history", async () => {
    const guard = vi.fn(() => Promise.resolve(true));
    setLeaveGuard(guard);

    await goBackOrHome();

    expect(guard).toHaveBeenCalledTimes(1);
    expect(backSpy).toHaveBeenCalledTimes(1);
    expect(guard.mock.invocationCallOrder[0]).toBeLessThan(
      backSpy.mock.invocationCallOrder[0]
    );
    expect(pushStateSpy).not.toHaveBeenCalled();
  });

  it("blocks the back-pop when the guard resolves false", async () => {
    const guard = vi.fn(() => Promise.resolve(false));
    setLeaveGuard(guard);

    await goBackOrHome();

    expect(backSpy).not.toHaveBeenCalled();
    expect(pushStateSpy).not.toHaveBeenCalled();
  });

  it("pops history unconditionally when no guard is registered", async () => {
    await goBackOrHome();
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to navigate('/') on a fresh page load (null history.state)", async () => {
    historyState = null;
    const guard = vi.fn(() => Promise.resolve(true));
    setLeaveGuard(guard);

    await goBackOrHome();

    expect(backSpy).not.toHaveBeenCalled();
    // navigate() owns the guard on this branch — exactly one prompt.
    expect(guard).toHaveBeenCalledTimes(1);
    expect(pushStateSpy).toHaveBeenCalledWith({}, "", "/");
  });

  it("fallback navigation honours a blocking guard", async () => {
    historyState = null;
    setLeaveGuard(vi.fn(() => Promise.resolve(false)));

    await goBackOrHome();

    expect(backSpy).not.toHaveBeenCalled();
    expect(pushStateSpy).not.toHaveBeenCalled();
  });
});
