import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntersectionController } from "../../src/util/intersection-controller.js";
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

const el = (id: string) => ({ id }) as unknown as Element;

beforeEach(() => {
  MockObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", MockObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IntersectionController", () => {
  it("invokes the callback only when the sentinel is intersecting", () => {
    const onIntersect = vi.fn();
    const ctrl = new IntersectionController(new FakeHost(), onIntersect);
    const target = el("sentinel");
    ctrl.observe(target, null, "200px");

    const obs = MockObserver.instances[0];
    expect(obs.observed).toEqual([target]);
    expect(obs.options).toMatchObject({ root: null, rootMargin: "200px" });

    obs.trigger(false);
    expect(onIntersect).not.toHaveBeenCalled();
    obs.trigger(true);
    expect(onIntersect).toHaveBeenCalledTimes(1);
  });

  it("re-observing the same target is a no-op; a new target replaces the observer", () => {
    const ctrl = new IntersectionController(new FakeHost(), vi.fn());
    const a = el("a");
    ctrl.observe(a, null);
    ctrl.observe(a, null);
    expect(MockObserver.instances).toHaveLength(1);

    const b = el("b");
    ctrl.observe(b, null);
    expect(MockObserver.instances).toHaveLength(2);
    expect(MockObserver.instances[0].disconnected).toBe(true);
    expect(MockObserver.instances[1].observed).toEqual([b]);
  });

  it("re-observes the same target when root or rootMargin changes", () => {
    const ctrl = new IntersectionController(new FakeHost(), vi.fn());
    const a = el("a");
    ctrl.observe(a, null, "0px");
    ctrl.observe(a, null, "200px");
    expect(MockObserver.instances).toHaveLength(2);
    expect(MockObserver.instances[0].disconnected).toBe(true);
    expect(MockObserver.instances[1].options).toMatchObject({ rootMargin: "200px" });
  });

  it("observeIfPresent tears down when the target is missing", () => {
    const ctrl = new IntersectionController(new FakeHost(), vi.fn());
    ctrl.observe(el("a"), null);
    ctrl.observeIfPresent(null, null);
    expect(MockObserver.instances[0].disconnected).toBe(true);
  });

  it("observeIfPresent observes against a null (viewport) root", () => {
    const ctrl = new IntersectionController(new FakeHost(), vi.fn());
    const target = el("sentinel");
    ctrl.observeIfPresent(target, null, "200px");
    expect(MockObserver.instances[0].observed).toEqual([target]);
    expect(MockObserver.instances[0].options).toMatchObject({ root: null });
  });

  it("disconnects the observer on host disconnect", () => {
    const ctrl = new IntersectionController(new FakeHost(), vi.fn());
    ctrl.observe(el("a"), null);
    ctrl.hostDisconnected();
    expect(MockObserver.instances[0].disconnected).toBe(true);
  });
});
