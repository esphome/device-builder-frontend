/**
 * @vitest-environment happy-dom
 *
 * A section switch reloads the config without tearing the form down: the
 * previous form stays mounted (inert, no focus target) until the next config
 * lands, writes are fenced meanwhile, and a failed reload drops it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
vi.mock("../../../src/components/device/config-entry-form.js", () => ({}));

import "../../_mock-webawesome.js";

import { deferred, flush } from "../../_dom.js";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { ComponentCatalogEntry } from "../../../src/api/types/components.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const YAML = [
  "sensor:",
  "  - platform: template",
  "switch:",
  "  - platform: template",
  "",
].join("\n");

const body = (id: string) =>
  makeComponentEntry(id, {
    name: id,
    config_entries: [
      makeConfigEntry({ key: "name", type: ConfigEntryType.STRING, label: "Name" }),
    ],
  });

function setup() {
  const pending = new Map<
    string,
    ReturnType<typeof deferred<Record<string, ComponentCatalogEntry>>>
  >();
  const bodies: Record<string, ComponentCatalogEntry> = {
    "sensor.template": body("sensor.template"),
    "switch.template": body("switch.template"),
  };
  const api = {
    getComponentBodies: (ids: string[]) => {
      const d = deferred<Record<string, ComponentCatalogEntry>>();
      pending.set(ids[0], d);
      return d.promise;
    },
  } as unknown as ESPHomeAPI;
  const c = new ESPHomeDeviceSectionConfig();
  const inner = c as any;
  inner._api = api;
  inner._localize = (key: string) => key;
  c.configuration = "device.yaml";
  c.yaml = YAML;
  c.sectionKey = "sensor.template";
  c.fromLine = 1;
  document.body.appendChild(c);
  const settle = async (id: string) => {
    pending.get(id)!.resolve({ [id]: bodies[id] });
    await flush();
    await c.updateComplete;
  };
  const fail = async (id: string) => {
    pending.get(id)!.reject(new Error("boom"));
    await flush();
    await c.updateComplete;
  };
  return { c, inner, bodies, settle, fail };
}

const form = (c: ESPHomeDeviceSectionConfig) =>
  c.shadowRoot!.querySelector("esphome-config-entry-form") as any;
const loading = (c: ESPHomeDeviceSectionConfig) =>
  c.shadowRoot!.querySelector(".loading");

async function firstLoad() {
  const s = setup();
  await s.c.updateComplete;
  await flush();
  await s.settle("sensor.template");
  return s;
}

async function switchToSwitch(c: ESPHomeDeviceSectionConfig) {
  c.sectionKey = "switch.template";
  c.fromLine = 3;
  await c.updateComplete;
  await flush();
  await c.updateComplete;
}

describe("section reload keeps the form mounted", () => {
  beforeEach(() => {
    _clearComponentCache();
    document.body.innerHTML = "";
  });

  it("shows the loading state on the first load only", async () => {
    const s = setup();
    await s.c.updateComplete;
    expect(loading(s.c)).not.toBeNull();
    expect(form(s.c)).toBeNull();
    await flush();
    await s.settle("sensor.template");
    expect(loading(s.c)).toBeNull();
    expect(form(s.c)).not.toBeNull();
  });

  it("keeps the previous form until the next config lands, then swaps", async () => {
    const { c, inner, bodies, settle } = await firstLoad();
    const before = form(c);
    expect(before.entries).toBe(bodies["sensor.template"].config_entries);

    await switchToSwitch(c);
    expect(inner._loading).toBe(true);
    expect(loading(c)).toBeNull();
    expect(form(c)).toBe(before);
    expect(form(c).entries).toBe(bodies["sensor.template"].config_entries);
    expect(form(c).sectionKey).toBe("sensor.template");
    expect(c.inert).toBe(true);
    expect(c.ariaBusy).toBe("true");

    await settle("switch.template");
    expect(inner._loading).toBe(false);
    expect(form(c)).toBe(before);
    expect(form(c).entries).toBe(bodies["switch.template"].config_entries);
    expect(form(c).sectionKey).toBe("switch.template");
    expect(c.inert).toBe(false);
    expect(c.ariaBusy).toBeNull();
  });

  it("keeps a same-section refresh live", async () => {
    const { c, inner, settle } = await firstLoad();
    _clearComponentCache();
    c.reload();
    await c.updateComplete;
    expect(inner._loading).toBe(true);
    expect(inner._reloading).toBe(false);
    expect(c.inert).toBe(false);
    expect(form(c)).not.toBeNull();
    await settle("sensor.template");
    expect(inner._loading).toBe(false);
  });

  it("keeps the fence when a refresh lands inside a retargeting load", async () => {
    const { c, inner, settle } = await firstLoad();
    await switchToSwitch(c);
    expect(inner._reloading).toBe(true);
    c.reload();
    await c.updateComplete;
    expect(inner._reloading).toBe(true);
    expect(c.inert).toBe(true);
    await settle("switch.template");
    expect(inner._reloading).toBe(false);
    expect(c.inert).toBe(false);
  });

  it("withholds the focus target from the stale form", async () => {
    const { c, settle } = await firstLoad();
    c.focusFieldPath = ["name"];
    await switchToSwitch(c);
    expect(form(c).focusFieldPath).toBeUndefined();
    await settle("switch.template");
    expect(form(c).focusFieldPath).toEqual(["name"]);
  });

  it("fences value writes while the reload is in flight", async () => {
    const { c, inner } = await firstLoad();
    await switchToSwitch(c);
    const valuesBefore = inner._values;
    const drafts: unknown[] = [];
    c.addEventListener("yaml-draft", (e) => drafts.push((e as CustomEvent).detail));
    inner._onValueChange(
      new CustomEvent("value-change", { detail: { path: ["name"], value: "x" } })
    );
    expect(inner._values).toBe(valuesBefore);
    expect(inner._draftTimer).toBeNull();
    expect(drafts).toEqual([]);
  });

  it("drops the stale form when the reload fails", async () => {
    const { c, inner, fail } = await firstLoad();
    await switchToSwitch(c);
    await fail("switch.template");
    expect(inner._config).toBeNull();
    expect(form(c)).toBeNull();
    expect(c.shadowRoot!.querySelector(".error")).not.toBeNull();
  });
});
