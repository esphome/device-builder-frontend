// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IntersectionController,
  type IntersectionControllerOptions,
} from "../../src/util/intersection-controller.js";
import { FakeHost } from "../_fake-host.js";

class MockObserver {
  static instances: MockObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(
    public cb: IntersectionObserverCallback,
    public options?: IntersectionObserverInit
  ) {
    MockObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }
  trigger(isIntersecting: boolean) {
    this.cb(
      [{ isIntersecting, target: this.observed[0] } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
}

class SentinelHost extends FakeHost {
  renderRoot = document.createElement("div");
  addSentinel(): HTMLElement {
    const sentinel = document.createElement("div");
    sentinel.className = "sentinel";
    this.renderRoot.appendChild(sentinel);
    return sentinel;
  }
  removeSentinel() {
    this.renderRoot.querySelector(".sentinel")?.remove();
  }
}

function setup(options?: IntersectionControllerOptions) {
  const host = new SentinelHost();
  const onIntersect = vi.fn();
  const ctrl = new IntersectionController(host, onIntersect, options);
  return { host, ctrl, onIntersect };
}

beforeEach(() => {
  MockObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", MockObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IntersectionController", () => {
  it("observes the sentinel against the viewport with the 200px default margin", () => {
    const { host, ctrl } = setup();
    const sentinel = host.addSentinel();
    ctrl.hostUpdated();

    const obs = MockObserver.instances[0];
    expect(obs.observed).toEqual([sentinel]);
    expect(obs.options).toMatchObject({ root: null, rootMargin: "200px" });
  });

  it("invokes the callback only when the sentinel is intersecting", () => {
    const { host, ctrl, onIntersect } = setup();
    host.addSentinel();
    ctrl.hostUpdated();

    const obs = MockObserver.instances[0];
    obs.trigger(false);
    expect(onIntersect).not.toHaveBeenCalled();
    obs.trigger(true);
    expect(onIntersect).toHaveBeenCalledTimes(1);
  });

  it("resolves rootSelector to the scroll container", () => {
    const { host, ctrl } = setup({ rootSelector: ".board-list" });
    const scrollBox = document.createElement("div");
    scrollBox.className = "board-list";
    host.renderRoot.appendChild(scrollBox);
    host.addSentinel();
    ctrl.hostUpdated();

    expect(MockObserver.instances[0].options).toMatchObject({ root: scrollBox });
  });

  it("honours a rootMargin override", () => {
    const { host, ctrl } = setup({ rootMargin: "50px" });
    host.addSentinel();
    ctrl.hostUpdated();

    expect(MockObserver.instances[0].options).toMatchObject({ rootMargin: "50px" });
  });

  it("creates no observer while the sentinel is absent", () => {
    const { ctrl } = setup();
    ctrl.hostUpdated();
    expect(MockObserver.instances).toHaveLength(0);
  });

  it("repeat updates with the same sentinel are a no-op", () => {
    const { host, ctrl } = setup();
    host.addSentinel();
    ctrl.hostUpdated();
    ctrl.hostUpdated();
    expect(MockObserver.instances).toHaveLength(1);
  });

  it("a re-rendered sentinel node replaces the observer", () => {
    const { host, ctrl } = setup();
    host.addSentinel();
    ctrl.hostUpdated();

    host.removeSentinel();
    const next = host.addSentinel();
    ctrl.hostUpdated();

    expect(MockObserver.instances).toHaveLength(2);
    expect(MockObserver.instances[0].disconnected).toBe(true);
    expect(MockObserver.instances[1].observed).toEqual([next]);
  });

  it("tears down when the sentinel leaves the DOM", () => {
    const { host, ctrl } = setup();
    host.addSentinel();
    ctrl.hostUpdated();

    host.removeSentinel();
    ctrl.hostUpdated();
    expect(MockObserver.instances[0].disconnected).toBe(true);
  });

  it("disconnects the observer on host disconnect", () => {
    const { host, ctrl } = setup();
    host.addSentinel();
    ctrl.hostUpdated();
    ctrl.hostDisconnected();
    expect(MockObserver.instances[0].disconnected).toBe(true);
  });
});
