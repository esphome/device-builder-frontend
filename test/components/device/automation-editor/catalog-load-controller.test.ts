import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));

import type { ReactiveControllerHost } from "lit";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../../../../src/api/index.js";
import type { AvailableAutomations } from "../../../../src/api/types/automations.js";
import { CatalogLoadController } from "../../../../src/components/device/automation-editor/catalog-load-controller.js";
import { _clearAutomationBodyCache } from "../../../../src/util/automation-body-cache.js";
import { identityLocalize } from "../../../_dom.js";

const localize = identityLocalize as never;
const stubHost = () => ({ addController: vi.fn() }) as unknown as ReactiveControllerHost;

const emptySlim = (): AvailableAutomations =>
  ({
    triggers: [],
    actions: [],
    conditions: [],
    scripts: [],
    devices: [],
  }) as unknown as AvailableAutomations;

const slimWithAction = (): AvailableAutomations =>
  ({
    triggers: [],
    actions: [{ id: "logger.log", config_entries: [] }],
    conditions: [],
    scripts: [],
    devices: [],
  }) as unknown as AvailableAutomations;

const slimWithTrigger = (): AvailableAutomations =>
  ({
    triggers: [{ id: "on_boot", config_entries: [] }],
    actions: [],
    conditions: [],
    scripts: [],
    devices: [],
  }) as unknown as AvailableAutomations;

describe("CatalogLoadController", () => {
  beforeEach(() => {
    _clearAutomationBodyCache();
    vi.mocked(toast.error).mockClear();
  });

  it("returns an empty result with no api or configuration", async () => {
    const ctrl = new CatalogLoadController(stubHost());
    expect(await ctrl.load(undefined, "a.yaml", localize)).toEqual({});
    const getAvailableAutomations = vi.fn();
    const api = { getAvailableAutomations } as unknown as ESPHomeAPI;
    expect(await ctrl.load(api, "", localize)).toEqual({});
    expect(getAvailableAutomations).not.toHaveBeenCalled();
  });

  it("resolves the hydrated available for a single load", async () => {
    const ctrl = new CatalogLoadController(stubHost());
    const api = {
      getAvailableAutomations: vi.fn().mockResolvedValue(emptySlim()),
      getAutomationBodies: vi.fn().mockResolvedValue({}),
    } as unknown as ESPHomeAPI;

    const { available, error } = await ctrl.load(api, "a.yaml", localize);

    expect(error).toBeUndefined();
    expect(available).toBeDefined();
  });

  it("discards a load superseded by a later one (structural guard)", async () => {
    const ctrl = new CatalogLoadController(stubHost());
    const api = {
      getAvailableAutomations: vi.fn().mockResolvedValue(emptySlim()),
      getAutomationBodies: vi.fn().mockResolvedValue({}),
    } as unknown as ESPHomeAPI;

    // Second call bumps the token before the first awaits resolve.
    const first = ctrl.load(api, "a.yaml", localize);
    const second = ctrl.load(api, "b.yaml", localize);
    const [r1, r2] = await Promise.all([first, second]);

    expect(r1).toEqual({});
    expect(r2.available).toBeDefined();
  });

  it("does not toast for a superseded partial-hydration load", async () => {
    const ctrl = new CatalogLoadController(stubHost());
    // Missing body -> failures -> the winning load toasts once; the
    // superseded load must stay silent.
    const api = {
      getAvailableAutomations: vi.fn().mockResolvedValue(slimWithAction()),
      getAutomationBodies: vi.fn().mockResolvedValue({}),
    } as unknown as ESPHomeAPI;

    const first = ctrl.load(api, "dev.yaml", localize);
    const second = ctrl.load(api, "dev.yaml", localize);
    await Promise.all([first, second]);

    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("discards an in-flight load after the host disconnects", async () => {
    const ctrl = new CatalogLoadController(stubHost());
    const api = {
      getAvailableAutomations: vi.fn().mockResolvedValue(emptySlim()),
      getAutomationBodies: vi.fn().mockResolvedValue({}),
    } as unknown as ESPHomeAPI;

    const p = ctrl.load(api, "a.yaml", localize);
    ctrl.hostDisconnected();

    expect(await p).toEqual({});
  });

  it("does not invoke a superseded load's onPaint (staleness wrap)", async () => {
    const ctrl = new CatalogLoadController(stubHost());
    const api = {
      getAvailableAutomations: vi.fn().mockResolvedValue(emptySlim()),
      getAutomationBodies: vi.fn().mockResolvedValue({}),
    } as unknown as ESPHomeAPI;

    const firstPaint = vi.fn();
    const secondPaint = vi.fn();
    // Second call bumps the token before the first awaits resolve, so
    // the first's early paint must never land.
    const first = ctrl.load(api, "a.yaml", localize, { onPaint: firstPaint });
    const second = ctrl.load(api, "b.yaml", localize, { onPaint: secondPaint });
    await Promise.all([first, second]);

    expect(firstPaint).not.toHaveBeenCalled();
    expect(secondPaint).toHaveBeenCalledTimes(1);
  });

  it("does not invoke onPaint after the host disconnects", async () => {
    const ctrl = new CatalogLoadController(stubHost());
    const api = {
      getAvailableAutomations: vi.fn().mockResolvedValue(emptySlim()),
      getAutomationBodies: vi.fn().mockResolvedValue({}),
    } as unknown as ESPHomeAPI;

    const onPaint = vi.fn();
    const p = ctrl.load(api, "a.yaml", localize, { onPaint });
    ctrl.hostDisconnected();
    await p;

    expect(onPaint).not.toHaveBeenCalled();
  });

  it("forwards an explicit lists selector so triggers hydrate too", async () => {
    const ctrl = new CatalogLoadController(stubHost());
    const getAutomationBodies = vi.fn().mockResolvedValue({});
    const api = {
      getAvailableAutomations: vi.fn().mockResolvedValue(slimWithTrigger()),
      getAutomationBodies,
    } as unknown as ESPHomeAPI;

    await ctrl.load(api, "a.yaml", localize, {
      lists: ["triggers", "actions", "conditions"],
    });

    expect(getAutomationBodies).toHaveBeenCalledTimes(1);
    expect(getAutomationBodies).toHaveBeenCalledWith([
      { type: "triggers", id: "on_boot" },
    ]);
  });

  it("defaults to actions + conditions, skipping trigger hydration", async () => {
    const ctrl = new CatalogLoadController(stubHost());
    const getAutomationBodies = vi.fn().mockResolvedValue({});
    const api = {
      getAvailableAutomations: vi.fn().mockResolvedValue(slimWithTrigger()),
      getAutomationBodies,
    } as unknown as ESPHomeAPI;

    // No options: the trigger-less default scopes hydration to actions
    // + conditions, so a trigger-only slim fetches no bodies.
    await ctrl.load(api, "a.yaml", localize);

    expect(getAutomationBodies).not.toHaveBeenCalled();
  });
});
