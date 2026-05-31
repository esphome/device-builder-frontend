import type { ReactiveController, ReactiveControllerHost } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { YamlSearchHit } from "../../src/api/types/devices.js";
import { YamlSearchController } from "../../src/components/yaml-search-controller.js";

class FakeHost implements ReactiveControllerHost {
  controllers: ReactiveController[] = [];
  updates = 0;
  addController(c: ReactiveController) {
    this.controllers.push(c);
  }
  removeController() {
    /* no-op */
  }
  requestUpdate() {
    this.updates++;
  }
  updateComplete = Promise.resolve(true);
}

/* The controller's only API surface is ``hits``, ``scheduleQuery``,
   ``clear``, and the host-lifecycle hooks. Tests stub the API and
   drive the debounce / dispatch loop with vi.useFakeTimers so the
   150ms wait is deterministic. */
function makeApi(impl: (q: string) => Promise<YamlSearchHit[]>) {
  return {
    searchYaml: vi.fn(({ query }: { query: string }) => impl(query)),
  } as unknown as ESPHomeAPI;
}

const HIT: YamlSearchHit = {
  configuration: "kitchen.yaml",
  device_name: "kitchen",
  friendly_name: "Kitchen",
  matches: [{ line_number: 1, line_text: "wifi:", before: [], after: [] }],
};

describe("YamlSearchController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers as a controller on the host", () => {
    const host = new FakeHost();
    const api = makeApi(async () => []);
    const ctrl = new YamlSearchController(host, () => api);
    expect(host.controllers).toContain(ctrl);
  });

  it("starts with hits === null and fires only after the 150ms debounce", async () => {
    const host = new FakeHost();
    const api = makeApi(async () => [HIT]);
    const ctrl = new YamlSearchController(host, () => api);

    ctrl.scheduleQuery("wifi");
    expect(ctrl.hits).toBeNull();
    expect(api.searchYaml).not.toHaveBeenCalled();

    // 149ms — still under the debounce; no fire.
    await vi.advanceTimersByTimeAsync(149);
    expect(api.searchYaml).not.toHaveBeenCalled();

    // Past the threshold; the dispatcher fires once.
    await vi.advanceTimersByTimeAsync(1);
    expect(api.searchYaml).toHaveBeenCalledTimes(1);
    expect(api.searchYaml).toHaveBeenCalledWith({ query: "wifi" });

    // Result lands; ``hits`` flips from null → the array.
    await vi.runAllTimersAsync();
    expect(ctrl.hits).toEqual([HIT]);
  });

  it("rapid keystrokes only fire one round trip after the pause", async () => {
    const host = new FakeHost();
    const api = makeApi(async () => [HIT]);
    const ctrl = new YamlSearchController(host, () => api);

    ctrl.scheduleQuery("w");
    await vi.advanceTimersByTimeAsync(50);
    ctrl.scheduleQuery("wi");
    await vi.advanceTimersByTimeAsync(50);
    ctrl.scheduleQuery("wif");
    await vi.advanceTimersByTimeAsync(50);
    ctrl.scheduleQuery("wifi");

    // The earlier timers were cancelled — only the last query
    // fires.
    await vi.runAllTimersAsync();

    expect(api.searchYaml).toHaveBeenCalledTimes(1);
    expect(api.searchYaml).toHaveBeenCalledWith({ query: "wifi" });
  });

  it("nulls hits and bumps seq immediately on every scheduleQuery", () => {
    const host = new FakeHost();
    const api = makeApi(async () => [HIT]);
    const ctrl = new YamlSearchController(host, () => api);

    // Pre-seed hits as if a previous query returned. The next
    // schedule must invalidate them immediately so the dropdown
    // doesn't show stale text behind "Searching…".
    ctrl.hits = [HIT];

    const before = host.updates;
    ctrl.scheduleQuery("wifi");

    expect(ctrl.hits).toBeNull();
    expect(host.updates).toBeGreaterThan(before);
  });

  it("drops stale results when a slow call resolves after a newer query", async () => {
    const host = new FakeHost();
    let resolveFirst: (h: YamlSearchHit[]) => void = () => {};
    const firstPromise = new Promise<YamlSearchHit[]>((r) => {
      resolveFirst = r;
    });
    const api = {
      searchYaml: vi
        .fn()
        .mockImplementationOnce(() => firstPromise)
        .mockImplementationOnce(async () => [HIT]),
    } as unknown as ESPHomeAPI;
    const ctrl = new YamlSearchController(host, () => api);

    ctrl.scheduleQuery("first");
    await vi.advanceTimersByTimeAsync(150);
    // First call is now in flight (un-resolved). Schedule a new
    // query — controller invalidates, debounces, fires the new
    // call, and the dispatcher will replay the second after the
    // first resolves.
    ctrl.scheduleQuery("second");
    await vi.advanceTimersByTimeAsync(150);

    // Resolve the original (stale) call. Its result must be
    // discarded — the seq advanced past it during the second
    // schedule.
    resolveFirst([{ ...HIT, friendly_name: "Stale" }]);
    await vi.runAllTimersAsync();

    expect(ctrl.hits).toEqual([HIT]);
  });

  it("clear() drops timer, pending input, and bumps seq", async () => {
    const host = new FakeHost();
    const api = makeApi(async () => [HIT]);
    const ctrl = new YamlSearchController(host, () => api);

    ctrl.scheduleQuery("wifi");
    ctrl.clear();

    // Past the would-be debounce window — nothing fires.
    await vi.runAllTimersAsync();
    expect(api.searchYaml).not.toHaveBeenCalled();
    expect(ctrl.hits).toBeNull();
  });

  it("clear() discards the result of an already-running call", async () => {
    const host = new FakeHost();
    let resolveRun: (h: YamlSearchHit[]) => void = () => {};
    const api = {
      searchYaml: vi.fn(
        () =>
          new Promise<YamlSearchHit[]>((r) => {
            resolveRun = r;
          })
      ),
    } as unknown as ESPHomeAPI;
    const ctrl = new YamlSearchController(host, () => api);

    ctrl.scheduleQuery("wifi");
    await vi.advanceTimersByTimeAsync(150);
    expect(api.searchYaml).toHaveBeenCalledTimes(1);

    ctrl.clear();
    resolveRun([HIT]);
    await vi.runAllTimersAsync();

    // Even though the underlying fetch finished, the seq advanced
    // during clear() so the result is dropped on the floor.
    expect(ctrl.hits).toBeNull();
  });

  it("falls back to empty hits when the API throws", async () => {
    const host = new FakeHost();
    const api = {
      searchYaml: vi.fn().mockRejectedValue(new Error("ws closed")),
    } as unknown as ESPHomeAPI;
    const ctrl = new YamlSearchController(host, () => api);

    ctrl.scheduleQuery("wifi");
    await vi.runAllTimersAsync();

    // Empty array, not null — distinguishes "fetched, nothing
    // matched" from "still loading" in the empty-state copy.
    expect(ctrl.hits).toEqual([]);
  });

  it("hostDisconnected clears all pending state", async () => {
    const host = new FakeHost();
    const api = makeApi(async () => [HIT]);
    const ctrl = new YamlSearchController(host, () => api);

    ctrl.scheduleQuery("wifi");
    ctrl.hostDisconnected();

    await vi.runAllTimersAsync();
    expect(api.searchYaml).not.toHaveBeenCalled();
  });

  it("sync() schedules when active + non-empty body", async () => {
    const host = new FakeHost();
    const api = makeApi(async () => [HIT]);
    const ctrl = new YamlSearchController(host, () => api);

    ctrl.sync(true, "wifi");
    await vi.runAllTimersAsync();

    expect(api.searchYaml).toHaveBeenCalledTimes(1);
    expect(api.searchYaml).toHaveBeenCalledWith({ query: "wifi" });
  });

  it("sync() clears when inactive", async () => {
    const host = new FakeHost();
    const api = makeApi(async () => [HIT]);
    const ctrl = new YamlSearchController(host, () => api);

    ctrl.scheduleQuery("wifi");
    ctrl.sync(false, "wifi"); // mode flipped off — drop everything
    await vi.runAllTimersAsync();

    expect(api.searchYaml).not.toHaveBeenCalled();
    expect(ctrl.hits).toBeNull();
  });

  it("sync() clears when active but body is empty", async () => {
    const host = new FakeHost();
    const api = makeApi(async () => [HIT]);
    const ctrl = new YamlSearchController(host, () => api);

    ctrl.sync(true, "");
    await vi.runAllTimersAsync();

    expect(api.searchYaml).not.toHaveBeenCalled();
    expect(ctrl.hits).toBeNull();
  });

  it("sync() treats whitespace-only as empty and clears", async () => {
    const host = new FakeHost();
    const api = makeApi(async () => [HIT]);
    const ctrl = new YamlSearchController(host, () => api);

    ctrl.sync(true, "   \t\n  ");
    await vi.runAllTimersAsync();

    expect(api.searchYaml).not.toHaveBeenCalled();
    expect(ctrl.hits).toBeNull();
  });

  it("sync() trims surrounding whitespace before scheduling", async () => {
    const host = new FakeHost();
    const api = makeApi(async () => [HIT]);
    const ctrl = new YamlSearchController(host, () => api);

    ctrl.sync(true, "  wifi  ");
    await vi.runAllTimersAsync();

    expect(api.searchYaml).toHaveBeenCalledWith({ query: "wifi" });
  });

  it("reads the API lazily so a late-bound api wiring is honoured", async () => {
    const host = new FakeHost();
    let api: ESPHomeAPI | null = null;
    const ctrl = new YamlSearchController(host, () => {
      if (!api) throw new Error("api not ready");
      return api;
    });

    // Wire the API only after construction — mirrors Lit's
    // ``@consume`` filling the field after initial setup.
    api = makeApi(async () => [HIT]);

    ctrl.scheduleQuery("wifi");
    await vi.runAllTimersAsync();

    expect(ctrl.hits).toEqual([HIT]);
  });
});
