import type { ReactiveControllerHost } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import { CatalogIndexController } from "../../../src/components/device/catalog-index-controller.js";
import { _clearCatalogCache } from "../../../src/util/yaml-completion-catalog.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";

const host = () =>
  ({ requestUpdate: vi.fn() }) as unknown as ReactiveControllerHost & {
    requestUpdate: ReturnType<typeof vi.fn>;
  };

const apiReturning = (getComponents: () => Promise<unknown>) =>
  ({ getComponents: vi.fn(getComponents) }) as unknown as ESPHomeAPI & {
    getComponents: ReturnType<typeof vi.fn>;
  };

const flush = async () => {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
};

describe("CatalogIndexController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    _clearCatalogCache();
  });

  it("loads on the first read, re-renders the host once, then serves the index", async () => {
    const hub = makeComponentEntry("modbus");
    const api = apiReturning(async () => ({ components: [hub], total: 1 }));
    const h = host();
    const controller = new CatalogIndexController(h, () => api);

    expect(controller.byId()).toBeNull();
    expect(controller.byId()).toBeNull();
    await flush();

    expect(api.getComponents).toHaveBeenCalledTimes(1);
    expect(h.requestUpdate).toHaveBeenCalledTimes(1);
    expect(controller.byId()?.get("modbus")).toBe(hub);
  });

  it("does nothing without an api", () => {
    const h = host();
    expect(new CatalogIndexController(h, () => undefined).byId()).toBeNull();
    expect(h.requestUpdate).not.toHaveBeenCalled();
  });

  it("backs off after a failed load instead of retrying on every read", async () => {
    const api = apiReturning(async () => {
      throw new Error("backend down");
    });
    const h = host();
    const controller = new CatalogIndexController(h, () => api);

    controller.byId();
    await flush();
    const afterFirst = api.getComponents.mock.calls.length;
    controller.byId();
    controller.byId();
    await flush();
    expect(api.getComponents.mock.calls.length).toBe(afterFirst);
    expect(h.requestUpdate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    controller.byId();
    await flush();
    expect(api.getComponents.mock.calls.length).toBeGreaterThan(afterFirst);
  });
});
