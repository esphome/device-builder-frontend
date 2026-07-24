/**
 * @vitest-environment happy-dom
 *
 * PortDisconnectWatcher: a spurious disconnect reacquires and reports the live
 * handle via onReplace (moving the watch); a device gone past the window
 * reports onGone; unwatch and host disconnect cancel a pending reacquire.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const reacquirePort = vi.fn();
vi.mock("../../src/util/web-serial.js", () => ({
  reacquirePort: (...a: unknown[]) => reacquirePort(...a),
}));

import { flush } from "../_dom.js";
import { FakeHost } from "../_fake-host.js";
import { makeDisconnectPort } from "../_web-serial.js";
import { PortDisconnectWatcher } from "../../src/web/util/port-disconnect-watcher.js";

function makeWatcher() {
  const onReplace = vi.fn();
  const onGone = vi.fn();
  const host = new FakeHost();
  const watcher = new PortDisconnectWatcher(host, onReplace, onGone);
  return { watcher, onReplace, onGone, host };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("PortDisconnectWatcher", () => {
  it("registers itself on the host", () => {
    const { watcher, host } = makeWatcher();
    expect(host.controllers).toContain(watcher);
  });

  it("replaces with the fresh handle and moves the watch to it", async () => {
    const old = makeDisconnectPort();
    const fresh = makeDisconnectPort();
    reacquirePort.mockResolvedValue(fresh);
    const { watcher, onReplace, onGone } = makeWatcher();

    watcher.watch(old);
    old.fire();
    await flush();

    expect(onReplace).toHaveBeenCalledWith(fresh);
    expect(onGone).not.toHaveBeenCalled();
    expect(old.listenerCount()).toBe(0);
    expect(fresh.listenerCount()).toBe(1);
  });

  it("keeps the surviving cached handle without listener churn", async () => {
    const port = makeDisconnectPort();
    reacquirePort.mockResolvedValue(port);
    const { watcher, onReplace } = makeWatcher();

    watcher.watch(port);
    port.fire();
    await flush();

    expect(onReplace).toHaveBeenCalledWith(port);
    expect(port.listenerCount()).toBe(1);
  });

  it("reports onGone when the device stays gone", async () => {
    const port = makeDisconnectPort();
    reacquirePort.mockResolvedValue(null);
    const { watcher, onReplace, onGone } = makeWatcher();

    watcher.watch(port);
    port.fire();
    await flush();

    expect(onGone).toHaveBeenCalledOnce();
    expect(onReplace).not.toHaveBeenCalled();
    expect(port.listenerCount()).toBe(0);
  });

  it("a disconnect after a replace still resets when the device stays gone", async () => {
    const old = makeDisconnectPort();
    const fresh = makeDisconnectPort();
    reacquirePort.mockResolvedValueOnce(fresh).mockResolvedValueOnce(null);
    const { watcher, onGone } = makeWatcher();

    watcher.watch(old);
    old.fire();
    await flush();
    fresh.fire();
    await flush();

    expect(onGone).toHaveBeenCalledOnce();
    expect(fresh.listenerCount()).toBe(0);
  });

  it("unwatch cancels a pending reacquire (no late callbacks)", async () => {
    const port = makeDisconnectPort();
    let resolve!: (v: SerialPort | null) => void;
    reacquirePort.mockReturnValue(new Promise((r) => (resolve = r)));
    const { watcher, onReplace, onGone } = makeWatcher();

    watcher.watch(port);
    port.fire();
    watcher.unwatch();
    resolve(makeDisconnectPort());
    await flush();

    expect(onReplace).not.toHaveBeenCalled();
    expect(onGone).not.toHaveBeenCalled();
    expect(port.listenerCount()).toBe(0);
  });

  it("marks the reacquire cancelled once superseded", async () => {
    const port = makeDisconnectPort();
    reacquirePort.mockReturnValue(new Promise(() => {}));
    const { watcher } = makeWatcher();

    watcher.watch(port);
    port.fire();
    const cancelled = reacquirePort.mock.calls[0][1].cancelled as () => boolean;
    expect(cancelled()).toBe(false);
    watcher.unwatch();
    expect(cancelled()).toBe(true);
  });

  it("a newer watch supersedes a pending reacquire from the old port", async () => {
    const old = makeDisconnectPort();
    const next = makeDisconnectPort();
    let resolve!: (v: SerialPort | null) => void;
    reacquirePort.mockReturnValue(new Promise((r) => (resolve = r)));
    const { watcher, onReplace } = makeWatcher();

    watcher.watch(old);
    old.fire();
    watcher.watch(next);
    resolve(makeDisconnectPort());
    await flush();

    expect(onReplace).not.toHaveBeenCalled();
    expect(old.listenerCount()).toBe(0);
    expect(next.listenerCount()).toBe(1);
  });

  it("host disconnect cancels a pending reacquire and detaches; reconnect re-attaches", async () => {
    const port = makeDisconnectPort();
    let resolve!: (v: SerialPort | null) => void;
    reacquirePort.mockReturnValue(new Promise((r) => (resolve = r)));
    const { watcher, onReplace, onGone } = makeWatcher();

    watcher.watch(port);
    port.fire();
    watcher.hostDisconnected();
    expect(port.listenerCount()).toBe(0);

    resolve(makeDisconnectPort());
    await flush();
    expect(onReplace).not.toHaveBeenCalled();
    expect(onGone).not.toHaveBeenCalled();

    watcher.hostConnected();
    expect(port.listenerCount()).toBe(1);
  });
});
