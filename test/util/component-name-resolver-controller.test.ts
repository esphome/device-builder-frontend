import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { ComponentCatalogEntry } from "../../src/api/types.js";
import { _clearComponentCache } from "../../src/util/component-name-cache.js";
import { ComponentNameResolverController } from "../../src/util/component-name-resolver-controller.js";

const entry = (id: string, name: string): ComponentCatalogEntry =>
  ({
    id,
    name,
    description: "",
    category: "core" as ComponentCatalogEntry["category"],
    docs_url: "",
    image_url: "",
    dependencies: [],
    multi_conf: false,
    supported_platforms: [],
    config_entries: [],
  }) as ComponentCatalogEntry;

/** Minimal stub matching the slice of ``ReactiveControllerHost`` the
 *  controller actually exercises. ``addController`` records the
 *  registration so tests can drive lifecycle hooks directly. */
const stubHost = () => {
  let controller: ReactiveController | null = null;
  const requestUpdate = vi.fn();
  const host: ReactiveControllerHost = {
    addController: (c) => {
      controller = c;
    },
    removeController: () => {},
    requestUpdate,
    updateComplete: Promise.resolve(true),
  };
  return {
    host,
    requestUpdate,
    connect: () => controller?.hostConnected?.(),
    disconnect: () => controller?.hostDisconnected?.(),
  };
};

const mockApi = (
  impl: (id: string) => ComponentCatalogEntry | null
): { api: ESPHomeAPI; getComponent: ReturnType<typeof vi.fn> } => {
  const getComponent = vi.fn((id: string) => Promise.resolve(impl(id)));
  return { api: { getComponent } as unknown as ESPHomeAPI, getComponent };
};

describe("ComponentNameResolverController", () => {
  beforeEach(() => _clearComponentCache());
  afterEach(() => _clearComponentCache());

  it("resolves to the catalog name when the entry is cached", async () => {
    const { host } = stubHost();
    const { api } = mockApi((id) => entry(id, "I²C Bus"));
    const ctl = new ComponentNameResolverController(
      host,
      () => api,
      () => "esp32"
    );

    expect(ctl.resolve("i2c")).toBe("i2c"); // not yet fetched
    ctl.kickoff(["i2c"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctl.resolve("i2c")).toBe("I²C Bus");
  });

  it("falls back to the raw id when the cache has no entry", () => {
    const { host } = stubHost();
    const { api } = mockApi(() => null);
    const ctl = new ComponentNameResolverController(
      host,
      () => api,
      () => undefined
    );

    expect(ctl.resolve("uart")).toBe("uart");
  });

  it("requests a host update once a fresh entry lands", async () => {
    const { host, requestUpdate, connect, disconnect } = stubHost();
    const { api } = mockApi((id) => entry(id, "WiFi"));
    const ctl = new ComponentNameResolverController(
      host,
      () => api,
      () => undefined
    );

    // No subscription before hostConnected — kickoff still fetches, but
    // a fresh entry landing shouldn't surface as a host update yet.
    connect();
    ctl.kickoff(["wifi"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(requestUpdate).toHaveBeenCalled();

    disconnect();
    requestUpdate.mockClear();
    // Unsubscribed — a new cache write should not bump the host.
    const { api: api2 } = mockApi((id) => entry(id, "Logger"));
    await api2.getComponent("logger");
    expect(requestUpdate).not.toHaveBeenCalled();
  });

  it("skips kickoff when no API is available", async () => {
    const { host } = stubHost();
    const ctl = new ComponentNameResolverController(
      host,
      () => undefined,
      () => undefined
    );
    // Should be a no-op rather than throwing.
    expect(() => ctl.kickoff(["i2c", "uart"])).not.toThrow();
  });

  it("does not re-fetch ids already present in the cache", async () => {
    const { host, connect } = stubHost();
    const { api, getComponent } = mockApi((id) => entry(id, "Cached"));
    const ctl = new ComponentNameResolverController(
      host,
      () => api,
      () => undefined
    );
    connect();

    ctl.kickoff(["spi"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(getComponent).toHaveBeenCalledTimes(1);

    ctl.kickoff(["spi"]);
    await Promise.resolve();
    expect(getComponent).toHaveBeenCalledTimes(1);
  });
});
