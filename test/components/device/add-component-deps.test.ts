import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { ComponentCatalogEntry } from "../../../src/api/types/components.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import {
  depsSatisfiedByProvides,
  findMissingDependencies,
  liveDependencies,
} from "../../../src/components/device/add-component-deps.js";
import { withMergedSourcePresence } from "../../../src/util/merged-source-presence.js";
import { _clearProvidesCache } from "../../../src/util/provides-cache.js";
import { parseTopLevelComponents } from "../../../src/util/yaml-serialize.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";
import { ethernetEntries } from "../../util/_make-ethernet-entry.js";

function providersResponse(ids: string[]) {
  return {
    components: ids.map((id) => ({ id }) as ComponentCatalogEntry),
    categories: [],
    total: ids.length,
    offset: 0,
    limit: 200,
  };
}

function stubApi(getComponents: ReturnType<typeof vi.fn>): ESPHomeAPI {
  return { getComponents } as unknown as ESPHomeAPI;
}

describe("findMissingDependencies", () => {
  it("flags a top-level hub dep that isn't configured", () => {
    expect(findMissingDependencies(["ld2410"], "sensor:\n  - platform: dht\n")).toEqual([
      "ld2410",
    ]);
  });

  it("satisfies a top-level hub dep from its block", () => {
    expect(findMissingDependencies(["ld2410"], "ld2410:\n  uart_id: u\n")).toEqual([]);
  });

  it("satisfies a platform-style hub dep from a configured platform", () => {
    // atm90e32's hub lives under `sensor:`, not at the top level — the
    // button platform depends on the bare `atm90e32` stem.
    const yaml = "sensor:\n  - platform: atm90e32\n    id: power\n";
    expect(findMissingDependencies(["atm90e32"], yaml)).toEqual([]);
  });

  it("flags a platform-style hub dep when its platform is absent", () => {
    expect(findMissingDependencies(["atm90e32"], "sensor:\n  - platform: dht\n")).toEqual(
      ["atm90e32"]
    );
  });

  it("satisfies a dotted dep from a matching configured platform", () => {
    // The pre-existing always-blocked update.http_request case.
    const yaml = "ota:\n  - platform: http_request\n";
    expect(findMissingDependencies(["ota.http_request"], yaml)).toEqual([]);
  });

  it("does not let a mirror platform satisfy a domain dependency", () => {
    // A `binary_sensor: - platform: switch` mirror must not pass for a
    // `switch:` dependency — switch is a platform domain, satisfied
    // only by a top-level `switch:` block.
    const yaml = "binary_sensor:\n  - platform: switch\n    name: x\n";
    expect(findMissingDependencies(["switch"], yaml)).toEqual(["switch"]);
  });

  it("satisfies a domain dependency from its top-level block", () => {
    const yaml = "switch:\n  - platform: gpio\n    pin: 1\n";
    expect(findMissingDependencies(["switch"], yaml)).toEqual([]);
  });

  it("returns only the unsatisfied subset", () => {
    const yaml = "ld2410:\n  uart_id: u\nsensor:\n  - platform: atm90e32\n";
    expect(findMissingDependencies(["ld2410", "atm90e32", "uart"], yaml)).toEqual([
      "uart",
    ]);
  });

  // Callers own the merged-source widening; these pin the widened set
  // flowing through the dep check the way production passes it.
  function widened(yaml: string, resolved: readonly string[]): ReadonlySet<string> {
    return withMergedSourcePresence(parseTopLevelComponents(yaml), yaml, resolved);
  }

  it("satisfies a dep from the widened presence when the YAML merges packages", () => {
    const yaml = "packages:\n  base: github://acme/base.yaml\n";
    expect(findMissingDependencies(["esp32"], yaml, widened(yaml, ["esp32"]))).toEqual(
      []
    );
  });

  it("ignores the resolved components for a plain config", () => {
    expect(
      findMissingDependencies(["esp32"], "api:\n", widened("api:\n", ["esp32"]))
    ).toEqual(["esp32"]);
  });

  it("matches a resolved platform against its alias-spelled dep", () => {
    const yaml = "packages:\n  base: github://acme/base.yaml\n";
    expect(findMissingDependencies(["rp2"], yaml, widened(yaml, ["rp2040"]))).toEqual([]);
  });

  it("satisfies a dotted dep from the resolved platforms when the YAML merges packages", () => {
    const yaml = "packages:\n  base: github://acme/base.yaml\n";
    expect(
      findMissingDependencies(["ota.esphome"], yaml, undefined, ["ota.esphome"])
    ).toEqual([]);
  });

  it("ignores the resolved platforms for a plain config", () => {
    expect(
      findMissingDependencies(["ota.esphome"], "api:\n", undefined, ["ota.esphome"])
    ).toEqual(["ota.esphome"]);
  });

  it("does not let a resolved bare component stem-satisfy a dotted dep", () => {
    // `esphome` is always loaded, so a bare resolved name must never
    // pass for the `ota.esphome` pair.
    const yaml = "packages:\n  base: github://acme/base.yaml\n";
    expect(
      findMissingDependencies(["ota.esphome"], yaml, widened(yaml, ["esphome"]))
    ).toEqual(["ota.esphome"]);
  });

  it("treats an empty dependency list as satisfied", () => {
    expect(findMissingDependencies([], "")).toEqual([]);
  });

  it("honours a precomputed presentComponents set over the yaml", () => {
    // Caller passes its already-parsed top-level set; the empty yaml
    // would otherwise report ld2410 missing.
    expect(findMissingDependencies(["ld2410"], "", new Set(["ld2410"]))).toEqual([]);
  });

  it("satisfies a rp2040 dep from a rp2 block", () => {
    // esphome 2026.7 renames the platform key; a config already migrated
    // to `rp2:` must not prompt for a duplicate rp2040 platform block.
    expect(findMissingDependencies(["rp2040"], "rp2:\n  board: rpipicow\n")).toEqual([]);
  });

  it("satisfies a rp2 dep from a rp2040 block", () => {
    expect(findMissingDependencies(["rp2"], "rp2040:\n  board: rpipicow\n")).toEqual([]);
  });
});

describe("depsSatisfiedByProvides", () => {
  beforeEach(_clearProvidesCache);

  it("satisfies a dep when a present component provides it", async () => {
    // bk72xx provides libretiny; the board's `bk72xx:` block covers the
    // libretiny_pwm dependency without the user adding anything.
    const getComponents = vi
      .fn()
      .mockResolvedValue(providersResponse(["bk72xx", "rtl87xx"]));
    const satisfied = await depsSatisfiedByProvides(
      stubApi(getComponents),
      ["libretiny"],
      new Set(["bk72xx", "output"]),
      { platform: "bk72xx", boardId: "generic-bk7231t" }
    );
    expect([...satisfied]).toEqual(["libretiny"]);
    expect(getComponents).toHaveBeenCalledTimes(1);
    expect(getComponents.mock.calls[0][0]).toMatchObject({
      provides: "libretiny",
      platform: "bk72xx",
      board_id: "generic-bk7231t",
    });
  });

  it("leaves a dep missing when no provider is present", async () => {
    const getComponents = vi
      .fn()
      .mockResolvedValue(providersResponse(["bk72xx", "rtl87xx"]));
    const satisfied = await depsSatisfiedByProvides(
      stubApi(getComponents),
      ["libretiny"],
      new Set(["esp32", "output"]),
      { platform: "esp32", boardId: null }
    );
    expect(satisfied.size).toBe(0);
  });

  it("leaves a dep missing when nothing provides it", async () => {
    const getComponents = vi.fn().mockResolvedValue(providersResponse([]));
    const satisfied = await depsSatisfiedByProvides(
      stubApi(getComponents),
      ["i2c"],
      new Set(["sensor"]),
      { platform: "esp32", boardId: null }
    );
    expect(satisfied.size).toBe(0);
  });

  it("satisfies a dep from a non-platform provider block", async () => {
    // usb_uart provides uart; a `usb_uart:` block covers a `uart` dep
    // without a literal `uart:` block.
    const getComponents = vi
      .fn()
      .mockResolvedValue(providersResponse(["usb_uart", "ble_nus"]));
    const satisfied = await depsSatisfiedByProvides(
      stubApi(getComponents),
      ["uart"],
      new Set(["usb_uart", "sensor"]),
      { platform: "esp32", boardId: null }
    );
    expect([...satisfied]).toEqual(["uart"]);
  });

  it("matches a rp2 provider against a legacy rp2040 block and canonicalizes the platform", async () => {
    const getComponents = vi.fn().mockResolvedValue(providersResponse(["rp2"]));
    const satisfied = await depsSatisfiedByProvides(
      stubApi(getComponents),
      ["pico_w"],
      new Set(["rp2040", "logger"]),
      { platform: "rp2040", boardId: null }
    );
    expect([...satisfied]).toEqual(["pico_w"]);
    // The provides index is keyed on the catalog's canonical platform key.
    expect(getComponents.mock.calls[0][0]).toMatchObject({ platform: "rp2" });
  });

  it("short-circuits an empty missing list without an API call", async () => {
    const getComponents = vi.fn();
    const satisfied = await depsSatisfiedByProvides(
      stubApi(getComponents),
      [],
      new Set(["bk72xx"]),
      { platform: "bk72xx", boardId: null }
    );
    expect(satisfied.size).toBe(0);
    expect(getComponents).not.toHaveBeenCalled();
  });

  it("skips dotted deps, which never key the provides index", async () => {
    const getComponents = vi.fn();
    const satisfied = await depsSatisfiedByProvides(
      stubApi(getComponents),
      ["ota.http_request"],
      new Set(["ota"]),
      { platform: "esp32", boardId: null }
    );
    expect(satisfied.size).toBe(0);
    expect(getComponents).not.toHaveBeenCalled();
  });

  it("caches provider lookups so a repeat resolution skips the query", async () => {
    const getComponents = vi.fn().mockResolvedValue(providersResponse(["bk72xx"]));
    const api = stubApi(getComponents);
    const args = [
      ["libretiny"],
      new Set(["bk72xx"]),
      { platform: "bk72xx", boardId: "b" },
    ] as const;
    await depsSatisfiedByProvides(api, ...args);
    await depsSatisfiedByProvides(api, ...args);
    expect(getComponents).toHaveBeenCalledTimes(1);
  });
});

describe("liveDependencies", () => {
  const scope = (values: Record<string, unknown>, entries = ethernetEntries()) => ({
    entries,
    values,
    board: null,
    presentComponents: new Set<string>(),
  });

  it("drops a dep whose only referencing entry the chosen type hides", () => {
    expect(liveDependencies(["spi"], scope({ type: "IP101" }))).toEqual([]);
  });

  it("keeps the dep once the chosen type shows the reference", () => {
    expect(liveDependencies(["spi"], scope({ type: "W5500" }))).toEqual(["spi"]);
  });

  it("resolves an untouched gate through the sibling default", () => {
    expect(liveDependencies(["spi"], scope({}, ethernetEntries("W5500")))).toEqual([
      "spi",
    ]);
    expect(liveDependencies(["spi"], scope({}, ethernetEntries("IP101")))).toEqual([]);
  });

  it("drops the dep while the gate is unset with no default", () => {
    expect(liveDependencies(["spi"], scope({}))).toEqual([]);
  });

  it("keeps a dep no entry references", () => {
    expect(liveDependencies(["spi", "uart"], scope({ type: "IP101" }))).toEqual(["uart"]);
  });

  it("does not walk nested entries", () => {
    const [type, spiId] = ethernetEntries();
    const nested = makeConfigEntry({
      key: "bus",
      type: ConfigEntryType.NESTED,
      config_entries: [spiId],
    });
    expect(liveDependencies(["spi"], scope({ type: "IP101" }, [type, nested]))).toEqual([
      "spi",
    ]);
  });
});
