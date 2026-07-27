// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactiveController } from "lit";
import {
  PopLeaveGuardController,
  consumePopGuardSuppression,
  installLeaveGuardInterceptor,
  popPushedEntrySilently,
  runLeaveGuard,
} from "../../src/util/navigation.js";
import { flushMicrotasks } from "../_dom.js";

/**
 * Pins the centralized popstate leave-guard: suppression first, one-shot
 * allow fall-through, dirty intercept with same-task re-push, replay only
 * on confirm, and interception ordering ahead of the router's listener.
 */

// Production installs this in createRouter, before the router's own
// popstate listener registers; delivery to the controller runs through it.
installLeaveGuardInterceptor();

class FakeHost {
  private _controllers: ReactiveController[] = [];
  addController(c: ReactiveController) {
    this._controllers.push(c);
  }
  removeController() {}
  requestUpdate() {}
  updateComplete = Promise.resolve(true);
  connect() {
    for (const c of this._controllers) c.hostConnected?.();
  }
  disconnect() {
    for (const c of this._controllers) c.hostDisconnected?.();
  }
}

function makeGuard(opts?: { dirty?: () => boolean; confirm?: () => Promise<boolean> }) {
  const host = new FakeHost();
  const confirm = vi.fn(opts?.confirm ?? (() => Promise.resolve(true)));
  const dirty = vi.fn(opts?.dirty ?? (() => true));
  const controller = new PopLeaveGuardController(host, {
    confirmLeave: confirm,
    isDirty: dirty,
    url: () => "/secrets",
  });
  host.connect();
  return { host, confirm, dirty, controller };
}

function popState(): PopStateEvent {
  const e = new PopStateEvent("popstate");
  vi.spyOn(e, "stopImmediatePropagation");
  return e;
}

describe("PopLeaveGuardController", () => {
  let hosts: FakeHost[];
  let pushState: ReturnType<typeof vi.spyOn>;
  let back: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    hosts = [];
    consumePopGuardSuppression();
    pushState = vi.spyOn(window.history, "pushState").mockImplementation(() => {});
    back = vi.spyOn(window.history, "back").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const host of hosts) host.disconnect();
    vi.restoreAllMocks();
  });

  const connect = (opts?: Parameters<typeof makeGuard>[0]) => {
    const made = makeGuard(opts);
    hosts.push(made.host);
    return made;
  };

  it("registers the confirm flow as the active leave guard for its lifetime", async () => {
    const { host, confirm } = connect();
    await expect(runLeaveGuard()).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);

    host.disconnect();
    await expect(runLeaveGuard()).resolves.toBe(true);
    // Guard cleared with the host, so leaving no longer consults it.
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("intercepts a dirty pop, re-pushes in the same task, and replays on confirm", async () => {
    const { confirm } = connect();
    const e = popState();
    window.dispatchEvent(e);

    expect(e.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    // Plain {} state: a navigate() stamp here would read as a fresh push
    // to the router's rollback.
    expect(pushState).toHaveBeenCalledWith({}, "", "/secrets");
    await flushMicrotasks(4);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("stays put when the confirm resolves false", async () => {
    connect({ confirm: () => Promise.resolve(false) });
    window.dispatchEvent(popState());
    await flushMicrotasks(4);
    expect(back).not.toHaveBeenCalled();
  });

  it("logs and stays put when the confirm rejects", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    connect({ confirm: () => Promise.reject(new Error("boom")) });
    window.dispatchEvent(popState());
    await flushMicrotasks(4);
    expect(back).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("Leave confirmation failed:", expect.any(Error));
  });

  it("lets a clean pop fall through untouched", () => {
    connect({ dirty: () => false });
    const e = popState();
    window.dispatchEvent(e);
    expect(e.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });

  it("consumes the rollback suppression before the dirty check", () => {
    const { dirty } = connect();
    popPushedEntrySilently();
    const e = popState();
    window.dispatchEvent(e);

    // A suppressed pop is a return to the page: no intercept, and the
    // side-effectful dirty check must not run.
    expect(dirty).not.toHaveBeenCalled();
    expect(e.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(consumePopGuardSuppression()).toBe(false);
  });

  it("allows exactly one pop through after an answered guard", async () => {
    const { dirty } = connect();
    await runLeaveGuard();

    window.dispatchEvent(popState());
    // The answered leave's own popstate falls through without re-checking.
    expect(dirty).not.toHaveBeenCalled();

    const second = popState();
    window.dispatchEvent(second);
    expect(second.stopImmediatePropagation).toHaveBeenCalledTimes(1);
  });

  it("resets the allow flag when the host disconnects", async () => {
    const { host } = connect();
    await runLeaveGuard();
    host.disconnect();
    host.connect();

    const e = popState();
    window.dispatchEvent(e);
    // A remounted page must not inherit its previous mount's answered
    // leave — the pop intercepts instead of falling through.
    expect(e.stopImmediatePropagation).toHaveBeenCalledTimes(1);
  });

  it("a departing controller doesn't disarm a successor's guard", async () => {
    const first = connect();
    const second = connect();
    first.host.disconnect();

    await expect(runLeaveGuard()).resolves.toBe(true);
    // Ownership check: only the active guard's owner may clear it.
    expect(second.confirm).toHaveBeenCalledTimes(1);
    expect(first.confirm).not.toHaveBeenCalled();
  });

  it("delivers popstate to the successor controller", () => {
    const first = connect();
    const second = connect();
    first.host.disconnect();

    window.dispatchEvent(popState());
    expect(second.dirty).toHaveBeenCalledTimes(1);
    expect(first.dirty).not.toHaveBeenCalled();
  });

  it("intercepts ahead of a router-style popstate listener", async () => {
    let isDirty = true;
    connect({ dirty: () => isDirty });
    // Bubble listener registered after the interceptor, mirroring
    // @lit-labs/router's registration at app-shell connect. popstate
    // targets window, so registration order alone decides delivery.
    const routerListener = vi.fn();
    window.addEventListener("popstate", routerListener);
    try {
      window.dispatchEvent(popState());
      // Dirty pop: the veto lands before the router can commit.
      expect(routerListener).not.toHaveBeenCalled();
      expect(pushState).toHaveBeenCalledWith({}, "", "/secrets");

      await runLeaveGuard();
      window.dispatchEvent(popState());
      // An answered leave's own pop falls through to the router.
      expect(routerListener).toHaveBeenCalledTimes(1);

      popPushedEntrySilently();
      window.dispatchEvent(popState());
      // A suppressed rollback pop reaches the router too.
      expect(routerListener).toHaveBeenCalledTimes(2);

      isDirty = false;
      window.dispatchEvent(popState());
      // And so does a clean pop.
      expect(routerListener).toHaveBeenCalledTimes(3);
    } finally {
      window.removeEventListener("popstate", routerListener);
    }
  });

  it("installs the interceptor once", () => {
    installLeaveGuardInterceptor();
    installLeaveGuardInterceptor();
    const { dirty } = connect();

    window.dispatchEvent(popState());
    // A duplicate listener would double-consult the dirty check.
    expect(dirty).toHaveBeenCalledTimes(1);
  });
});
