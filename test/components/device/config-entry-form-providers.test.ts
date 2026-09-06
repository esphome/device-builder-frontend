/**
 * @vitest-environment happy-dom
 *
 * ``_resolveInterfaceProviders`` backs the id-reference dropdown's
 * cross-domain lookup through the session provider cache: one paged
 * ``provides`` fetch shared by every form, and a failed fetch left uncached
 * so a later render can retry.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { flush } from "../../_dom.js";
import type { ComponentCatalogEntry } from "../../../src/api/types/components.js";
import { ESPHomeConfigEntryForm } from "../../../src/components/device/config-entry-form.js";
import type { ComponentProvider } from "../../../src/util/config-entry-yaml-scan.js";
import { COMPONENT_FETCH_PAGE } from "../../../src/util/fetch-all-components.js";
import { _clearProvidesCache } from "../../../src/util/provides-cache.js";

const resolve = (
  form: ESPHomeConfigEntryForm,
  name: string
): readonly ComponentProvider[] | null =>
  (
    form as unknown as {
      _resolveInterfaceProviders(n: string): readonly ComponentProvider[] | null;
    }
  )._resolveInterfaceProviders(name);

function withApi(getComponents: ReturnType<typeof vi.fn>): ESPHomeConfigEntryForm {
  const form = new ESPHomeConfigEntryForm();
  Object.assign(form as unknown as Record<string, unknown>, { _api: { getComponents } });
  return form;
}

function response(ids: string[]) {
  return {
    components: ids.map((id) => ({ id }) as ComponentCatalogEntry),
    categories: [],
    total: ids.length,
    offset: 0,
    limit: 200,
  };
}

describe("config-entry-form _resolveInterfaceProviders", () => {
  beforeEach(() => _clearProvidesCache());

  it("returns null on the first miss, then the fetched providers, fetching once", async () => {
    const getComponents = vi
      .fn()
      .mockResolvedValue(response(["sensor.adc", "sensor.ads1115"]));
    const form = withApi(getComponents);

    // First miss: unsettled (null), fetch kicked off.
    expect(resolve(form, "voltage_sampler")).toBeNull();
    // A second call while in flight must not fire a duplicate fetch.
    resolve(form, "voltage_sampler");
    await flush();

    expect(getComponents).toHaveBeenCalledTimes(1);
    expect(getComponents.mock.calls[0][0]).toMatchObject({ provides: "voltage_sampler" });
    // Resolved cache, returned synchronously, mapped through parseCatalogId.
    expect(resolve(form, "voltage_sampler")).toEqual([
      { domain: "sensor", stem: "adc" },
      { domain: "sensor", stem: "ads1115" },
    ]);
    expect(getComponents).toHaveBeenCalledTimes(1);
  });

  it("caches [] for an empty success (a same-domain reference)", async () => {
    const getComponents = vi.fn().mockResolvedValue(response([]));
    const form = withApi(getComponents);
    resolve(form, "i2c");
    await flush();
    expect(resolve(form, "i2c")).toEqual([]);
    // Cached: no refetch.
    expect(getComponents).toHaveBeenCalledTimes(1);
  });

  it("collects every page when the provider set exceeds one page", async () => {
    const count = COMPONENT_FETCH_PAGE + 1;
    const all = Array.from({ length: count }, (_, i) => `sensor.c${i}`);
    const getComponents = vi.fn(async (args: { offset?: number; limit?: number }) => ({
      ...response(all.slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? 50))),
      total: all.length,
      offset: args.offset ?? 0,
    }));
    const form = withApi(getComponents as unknown as ReturnType<typeof vi.fn>);

    resolve(form, "sensor");
    await flush();

    expect(getComponents).toHaveBeenCalledTimes(2);
    const providers = resolve(form, "sensor");
    expect(providers).toHaveLength(count);
    expect(providers?.[count - 1]).toEqual({
      domain: "sensor",
      stem: `c${count - 1}`,
    });
  });

  it("does not cache [] on a failed fetch, so a later render retries", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const getComponents = vi
      .fn()
      .mockRejectedValueOnce(new Error("ws down"))
      .mockResolvedValueOnce(response(["sensor.adc"]));
    const form = withApi(getComponents);

    resolve(form, "voltage_sampler");
    await flush();
    // Failure left the cache unset; the next call retries (still
    // unsettled) rather than returning a poisoned empty list forever.
    expect(resolve(form, "voltage_sampler")).toBeNull();
    await flush();
    expect(getComponents).toHaveBeenCalledTimes(2);
    expect(resolve(form, "voltage_sampler")).toEqual([{ domain: "sensor", stem: "adc" }]);
  });

  it("shares one fetch across form instances", async () => {
    const getComponents = vi.fn().mockResolvedValue(response(["sensor.adc"]));
    const a = withApi(getComponents);
    const b = withApi(getComponents);
    expect(resolve(a, "voltage_sampler")).toBeNull();
    expect(resolve(b, "voltage_sampler")).toBeNull();
    await flush();
    expect(getComponents).toHaveBeenCalledTimes(1);
    expect(resolve(b, "voltage_sampler")).toEqual([{ domain: "sensor", stem: "adc" }]);
    // A form built after the fetch settled reads the cache synchronously.
    expect(resolve(withApi(getComponents), "voltage_sampler")).toEqual([
      { domain: "sensor", stem: "adc" },
    ]);
    expect(getComponents).toHaveBeenCalledTimes(1);
  });
});
