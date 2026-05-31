import type { ReactiveControllerHost } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { AutomationTrigger } from "../../../src/api/types/automations.js";
import { TriggerCatalogController } from "../../../src/components/device/trigger-catalog-controller.js";
import {
  _clearAutomationCatalogCache,
  fetchAutomationTriggers,
  getCachedAutomationTriggers,
} from "../../../src/util/automation-catalog-cache.js";

const fakeHost = (): ReactiveControllerHost =>
  ({
    addController: vi.fn(),
    removeController: vi.fn(),
    requestUpdate: vi.fn(),
    updateComplete: Promise.resolve(true),
  }) as unknown as ReactiveControllerHost;

const trigger = (id: string, name: string): AutomationTrigger => ({
  id,
  name,
  description: "",
  docs_url: "",
  applies_to: [],
  is_device_level: true,
  repeatable: false,
  config_entries: [],
});

const fakeApi = (triggers: AutomationTrigger[]): ESPHomeAPI =>
  ({ getAutomationTriggers: vi.fn(async () => triggers) }) as unknown as ESPHomeAPI;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => _clearAutomationCatalogCache());

describe("TriggerCatalogController", () => {
  it("returns the fallback before the catalog is cached", () => {
    const c = new TriggerCatalogController(fakeHost(), () => ({}));
    expect(c.resolveName("binary_sensor", "on_state", "fallback")).toBe("fallback");
  });

  it("resolves a component trigger to its catalog name once cached", async () => {
    await fetchAutomationTriggers(
      fakeApi([trigger("binary_sensor.on_state", "Binary Sensor → On State")])
    );
    const c = new TriggerCatalogController(fakeHost(), () => ({}));
    expect(c.resolveName("binary_sensor", "on_state", "raw")).toBe(
      "Binary Sensor → On State"
    );
  });

  it("resolves a device-level trigger by its bare event key", async () => {
    await fetchAutomationTriggers(fakeApi([trigger("on_boot", "On Boot")]));
    const c = new TriggerCatalogController(fakeHost(), () => ({}));
    expect(c.resolveName("esphome", "on_boot", "raw")).toBe("On Boot");
  });

  it("falls back when the cached catalog has no matching id", async () => {
    await fetchAutomationTriggers(
      fakeApi([trigger("switch.on_turn_on", "Switch → On Turn On")])
    );
    const c = new TriggerCatalogController(fakeHost(), () => ({}));
    expect(c.resolveName("binary_sensor", "on_state", "raw")).toBe("raw");
  });

  it("ensure() fetches once when uncached and is a no-op once cached", async () => {
    const api = fakeApi([trigger("binary_sensor.on_state", "Binary Sensor → On State")]);
    const c = new TriggerCatalogController(fakeHost(), () => ({ api }));
    c.ensure();
    await flush();
    expect(getCachedAutomationTriggers()).toBeDefined();
    c.ensure();
    expect(api.getAutomationTriggers).toHaveBeenCalledTimes(1);
  });

  it("ensure() is a no-op without an api", () => {
    const c = new TriggerCatalogController(fakeHost(), () => ({}));
    expect(() => c.ensure()).not.toThrow();
  });

  it("re-renders the host when a catalog fetch lands while connected", async () => {
    const host = fakeHost();
    const c = new TriggerCatalogController(host, () => ({}));
    c.hostConnected();
    await fetchAutomationTriggers(fakeApi([trigger("on_boot", "On Boot")]));
    expect(host.requestUpdate).toHaveBeenCalled();
    c.hostDisconnected();
  });
});
