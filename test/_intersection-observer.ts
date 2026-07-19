/**
 * IntersectionObserver mock for suites that drive sentinel-based
 * infinite scroll. Install with
 * ``vi.stubGlobal("IntersectionObserver", MockObserver)``; reset
 * ``MockObserver.instances`` in ``beforeEach`` and fire crossings via
 * ``instance.trigger(isIntersecting)``.
 */
export class MockObserver {
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
