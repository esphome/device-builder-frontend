/**
 * @vitest-environment happy-dom
 *
 * Behavioral tests for ``device-navigator``'s ``_kickoffNameResolves``
 * gating. The navigator pulls in several dialog children that we
 * don't need to render here; ``vi.mock`` no-ops them so the element
 * can construct in happy-dom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/components/device/add-automation-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-component-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-config-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-script-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import type { ESPHomeAPI } from "../../../src/api/index.js";
import { _clearAutomationCatalogCache } from "../../../src/util/automation-catalog-cache.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { ESPHomeDeviceNavigator } from "../../../src/components/device/device-navigator.js";

async function flushPending(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function mountNavigator(
  api: ESPHomeAPI,
  props: Partial<{
    yaml: string;
    platform: string;
    platformReady: boolean;
  }> = {}
): Promise<ESPHomeDeviceNavigator> {
  const nav = new ESPHomeDeviceNavigator();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (nav as any)._api = api;
  if (props.yaml !== undefined) nav.yaml = props.yaml;
  if (props.platform !== undefined) nav.platform = props.platform;
  if (props.platformReady !== undefined) nav.platformReady = props.platformReady;
  document.body.appendChild(nav);
  await nav.updateComplete;
  await flushPending();
  return nav;
}

const YAML = "wifi:\n  ssid: foo\n";

describe("device-navigator kickoff gating", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    _clearAutomationCatalogCache();
    _clearComponentCache();
  });

  beforeEach(() => {
    // Clear any cache state from prior tests so fetch counters are
    // accurate per test.
    _clearAutomationCatalogCache();
    _clearComponentCache();
  });

  it("does not kickoff when yaml is set but platformReady is false", async () => {
    const getAutomationTriggers = vi.fn().mockResolvedValue([]);
    const getComponentBodies = vi.fn().mockResolvedValue({});
    const api = { getAutomationTriggers, getComponentBodies } as unknown as ESPHomeAPI;

    await mountNavigator(api, { yaml: YAML, platformReady: false });

    expect(getAutomationTriggers).not.toHaveBeenCalled();
    expect(getComponentBodies).not.toHaveBeenCalled();
  });

  it("does not kickoff when platformReady flips true but yaml is empty", async () => {
    const getAutomationTriggers = vi.fn().mockResolvedValue([]);
    const getComponentBodies = vi.fn().mockResolvedValue({});
    const api = { getAutomationTriggers, getComponentBodies } as unknown as ESPHomeAPI;

    const nav = await mountNavigator(api, { yaml: "", platformReady: false });
    nav.platformReady = true;
    await nav.updateComplete;
    await flushPending();

    expect(getAutomationTriggers).not.toHaveBeenCalled();
    expect(getComponentBodies).not.toHaveBeenCalled();
  });

  it("kickoffs exactly once when yaml lands first, then platformReady", async () => {
    const getAutomationTriggers = vi.fn().mockResolvedValue([]);
    const getComponentBodies = vi.fn().mockResolvedValue({});
    const api = {
      getAutomationTriggers,
      getComponentBodies,
    } as unknown as ESPHomeAPI;

    const nav = await mountNavigator(api, { yaml: YAML, platformReady: false });
    expect(getAutomationTriggers).not.toHaveBeenCalled();

    nav.platform = "esp32";
    nav.platformReady = true;
    await nav.updateComplete;
    // Microtask-batched body cache; let queued fetches flush.
    await flushPending(10);

    expect(getAutomationTriggers).toHaveBeenCalledTimes(1);
    expect(getAutomationTriggers).toHaveBeenCalledWith("esp32", undefined);
  });

  it("kickoffs exactly once when platformReady lands first, then yaml", async () => {
    const getAutomationTriggers = vi.fn().mockResolvedValue([]);
    const getComponentBodies = vi.fn().mockResolvedValue({});
    const api = {
      getAutomationTriggers,
      getComponentBodies,
    } as unknown as ESPHomeAPI;

    const nav = await mountNavigator(api, {
      yaml: "",
      platform: "esp32",
      platformReady: true,
    });
    expect(getAutomationTriggers).not.toHaveBeenCalled();

    nav.yaml = YAML;
    await nav.updateComplete;
    await flushPending(10);

    expect(getAutomationTriggers).toHaveBeenCalledTimes(1);
    expect(getAutomationTriggers).toHaveBeenCalledWith("esp32", undefined);
  });

  it("kickoffs once with platform=undefined when platformReady flips true with empty platform", async () => {
    // Platform-less device path (board fetch failed / device has no
    // board): parent flips ``platformReady`` true but leaves
    // ``platform=""``. Labels still resolve via the empty bucket.
    const getAutomationTriggers = vi.fn().mockResolvedValue([]);
    const api = { getAutomationTriggers } as unknown as ESPHomeAPI;

    const nav = await mountNavigator(api, { yaml: YAML, platformReady: false });
    nav.platformReady = true;
    await nav.updateComplete;
    await flushPending(10);

    expect(getAutomationTriggers).toHaveBeenCalledTimes(1);
    expect(getAutomationTriggers).toHaveBeenCalledWith(undefined, undefined);
  });

  it("does not re-kickoff when both fields stay set and nothing else changes", async () => {
    const getAutomationTriggers = vi.fn().mockResolvedValue([]);
    const api = { getAutomationTriggers } as unknown as ESPHomeAPI;

    const nav = await mountNavigator(api, {
      yaml: YAML,
      platform: "esp32",
      platformReady: true,
    });
    await flushPending(10);
    expect(getAutomationTriggers).toHaveBeenCalledTimes(1);

    // An unrelated prop change shouldn't refire (selection update
    // doesn't touch yaml / platform / platformReady).
    nav.selectedKey = "wifi";
    await nav.updateComplete;
    await flushPending(10);

    expect(getAutomationTriggers).toHaveBeenCalledTimes(1);
  });
});
