/**
 * @vitest-environment happy-dom
 *
 * ``filterByDomain`` routes a cross-domain reference (ct_clamp's
 * ``voltage_sampler``) through the ``provides`` filter so the Add
 * component picker lists the interface's providers, falling back to a
 * search only when the domain isn't a homeless interface (issue #1275).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/badge/badge.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import type { ComponentCatalogEntry } from "../../../src/api/types/components.js";
import { ESPHomeComponentCatalog } from "../../../src/components/device/component-catalog.js";

function emptyResponse() {
  return { components: [], categories: [], total: 0, offset: 0, limit: 50 };
}

function response(ids: string[]) {
  return {
    components: ids.map((id) => ({ id }) as ComponentCatalogEntry),
    categories: [],
    total: ids.length,
    offset: 0,
    limit: 50,
  };
}

describe("component-catalog filterByDomain provides routing", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("probes the provides filter for an interface domain", async () => {
    const el = new ESPHomeComponentCatalog();
    const getComponents = vi
      .fn()
      .mockResolvedValue(response(["sensor.adc", "sensor.ads1115"]));
    Object.assign(el as unknown as Record<string, unknown>, { _api: { getComponents } });

    el.filterByDomain("voltage_sampler");
    await Promise.resolve();
    await Promise.resolve();

    expect(getComponents).toHaveBeenCalledTimes(1);
    expect(getComponents.mock.calls[0][0]).toMatchObject({ provides: "voltage_sampler" });
    expect(getComponents.mock.calls[0][0].query).toBeUndefined();
    expect(el._components.map((c) => c.id)).toEqual(["sensor.adc", "sensor.ads1115"]);
  });

  it("falls back to a search when the provides probe is empty", async () => {
    const el = new ESPHomeComponentCatalog();
    const getComponents = vi
      .fn()
      .mockResolvedValueOnce(emptyResponse()) // provides probe: not an interface
      .mockResolvedValueOnce(response(["i2c"])); // search fallback
    Object.assign(el as unknown as Record<string, unknown>, { _api: { getComponents } });

    el.filterByDomain("i2c");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(getComponents).toHaveBeenCalledTimes(2);
    expect(getComponents.mock.calls[0][0]).toMatchObject({ provides: "i2c" });
    expect(getComponents.mock.calls[1][0]).toMatchObject({ query: "i2c" });
    expect(getComponents.mock.calls[1][0].provides).toBeUndefined();
    expect(el._components.map((c) => c.id)).toEqual(["i2c"]);
  });

  it("uses the category filter, not provides, for a real category", async () => {
    const el = new ESPHomeComponentCatalog();
    const getComponents = vi.fn().mockResolvedValue(response(["sensor.dht"]));
    Object.assign(el as unknown as Record<string, unknown>, { _api: { getComponents } });

    el.filterByDomain("sensor");
    await Promise.resolve();
    await Promise.resolve();

    expect(getComponents).toHaveBeenCalledTimes(1);
    expect(getComponents.mock.calls[0][0]).toMatchObject({ category: "sensor" });
    expect(getComponents.mock.calls[0][0].provides).toBeUndefined();
  });
});
