/**
 * @vitest-environment happy-dom
 *
 * PortDisconnectWatcher: a spurious disconnect reacquires and reports the live
 * handle via onReplace (moving the watch); a device gone past the window
 * reports onGone; unwatch cancels a pending reacquire.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const reacquirePort = vi.fn();
vi.mock("../../src/util/web-serial.js", () => ({
  reacquirePort: (...a: unknown[]) => reacquirePort(...a),
}));

import { PortDisconnectWatcher } from "../../src/web/util/port-disconnect-watcher.js";

type FakePort = SerialPort & { fire: () => void; listenerCount: () => number };

function fakePort(): FakePort {
  const listeners = new Set<EventListener>();
  return {
    addEventListener: (_t: string, l: EventListener) => listeners.add(l),
    removeEventListener: (_t: string, l: EventListener) => listeners.delete(l),
    fire: () => [...listeners].forEach((l) => l(new Event("disconnect"))),
    listenerCount: () => listeners.size,
  } as unknown as FakePort;
}

function makeWatcher() {
  const onReplace = vi.fn();
  const onGone = vi.fn();
  return { watcher: new PortDisconnectWatcher(onReplace, onGone), onReplace, onGone };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.clearAllMocks();
});

describe("PortDisconnectWatcher", () => {
  it("replaces with the fresh handle and moves the watch to it", async () => {
    const old = fakePort();
    const fresh = fakePort();
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
    const port = fakePort();
    reacquirePort.mockResolvedValue(port);
    const { watcher, onReplace } = makeWatcher();

    watcher.watch(port);
    port.fire();
    await flush();

    expect(onReplace).toHaveBeenCalledWith(port);
    expect(port.listenerCount()).toBe(1);
  });

  it("reports onGone when the device stays gone", async () => {
    const port = fakePort();
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
    const old = fakePort();
    const fresh = fakePort();
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
    const port = fakePort();
    let resolve!: (v: SerialPort | null) => void;
    reacquirePort.mockReturnValue(new Promise((r) => (resolve = r)));
    const { watcher, onReplace, onGone } = makeWatcher();

    watcher.watch(port);
    port.fire();
    watcher.unwatch();
    resolve(fakePort());
    await flush();

    expect(onReplace).not.toHaveBeenCalled();
    expect(onGone).not.toHaveBeenCalled();
    expect(port.listenerCount()).toBe(0);
  });

  it("a newer watch supersedes a pending reacquire from the old port", async () => {
    const old = fakePort();
    const next = fakePort();
    let resolve!: (v: SerialPort | null) => void;
    reacquirePort.mockReturnValue(new Promise((r) => (resolve = r)));
    const { watcher, onReplace } = makeWatcher();

    watcher.watch(old);
    old.fire();
    watcher.watch(next);
    resolve(fakePort());
    await flush();

    expect(onReplace).not.toHaveBeenCalled();
    expect(old.listenerCount()).toBe(0);
    expect(next.listenerCount()).toBe(1);
  });
});
