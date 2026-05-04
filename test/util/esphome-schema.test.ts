import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetSchemaCacheForTests,
  fetchBundle,
  getActions,
  getTriggerKeys,
} from "../../src/util/esphome-schema.js";

interface ApiStub {
  getVersion: () => Promise<{ server_version: string; esphome_version: string }>;
}

function makeApi(version = "2026.5.0"): ApiStub {
  return {
    getVersion: async () => ({
      server_version: "0.0.0",
      esphome_version: version,
    }),
  };
}

const ESPHOME_BUNDLE = {
  core: { components: {}, platforms: {} },
  esphome: {
    schemas: {
      CONFIG_SCHEMA: {
        type: "schema",
        schema: {
          config_vars: {
            name: { type: "string", key: "Required" },
            on_boot: { type: "trigger", docs: "Run when device boots" },
            on_loop: { type: "trigger", docs: "Run every loop iteration" },
            on_shutdown: { type: "trigger" },
          },
        },
      },
    },
  },
};

const SENSOR_BUNDLE = {
  "binary_sensor.gpio": {
    schemas: {
      CONFIG_SCHEMA: {
        type: "schema",
        schema: {
          config_vars: {
            pin: { type: "pin" },
            on_press: { type: "trigger", docs: "Press fired" },
            on_release: { type: "trigger" },
          },
        },
      },
    },
  },
};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  _resetSchemaCacheForTests();
  fetchSpy = vi.fn();
  // ``vi.stubGlobal`` is the repo's convention for swapping
  // built-ins; matching ``vi.unstubAllGlobals`` in afterEach
  // restores the original ``fetch`` so a later test that doesn't
  // mock can't accidentally reuse this spy.
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchBundle", () => {
  it("uses the version reported by the API when schema.esphome.io has it", async () => {
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      if (url.includes("/2026.5.0/esphome.json"))
        return new Response(JSON.stringify(ESPHOME_BUNDLE), { status: 200 });
      throw new Error(`unexpected fetch ${url}`);
    });
    const bundle = await fetchBundle(makeApi() as never, "esphome");
    expect(bundle).not.toBeNull();
    expect(bundle?.esphome?.schemas?.CONFIG_SCHEMA?.schema.config_vars.on_boot).toBeDefined();
  });

  it("falls back to /dev/ when the version-specific bundle is missing", async () => {
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      // HEAD probe says the version-specific bundle isn't published yet.
      if (init?.method === "HEAD") return new Response(null, { status: 404 });
      if (url.includes("/dev/esphome.json"))
        return new Response(JSON.stringify(ESPHOME_BUNDLE), { status: 200 });
      throw new Error(`unexpected fetch ${url}`);
    });
    const bundle = await fetchBundle(makeApi() as never, "esphome");
    expect(bundle).not.toBeNull();
  });

  it("returns null when the schema host is unreachable (CSP / offline / DNS)", async () => {
    fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"));
    // Silence the console.debug emitted by graceful-degrade path.
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const bundle = await fetchBundle(makeApi() as never, "esphome");
    expect(bundle).toBeNull();
    debugSpy.mockRestore();
  });

  it("returns null on a non-2xx response", async () => {
    fetchSpy.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(null, { status: 500 });
    });
    const bundle = await fetchBundle(makeApi() as never, "esphome");
    expect(bundle).toBeNull();
  });

  it("deduplicates concurrent requests for the same bundle", async () => {
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      if (url.includes("esphome.json"))
        return new Response(JSON.stringify(ESPHOME_BUNDLE), { status: 200 });
      throw new Error(`unexpected fetch ${url}`);
    });
    const api = makeApi() as never;
    await Promise.all([fetchBundle(api, "esphome"), fetchBundle(api, "esphome")]);
    // One HEAD probe + one GET, regardless of how many in-flight callers.
    const gets = fetchSpy.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method !== "HEAD",
    );
    expect(gets.length).toBe(1);
  });
});

describe("getTriggerKeys", () => {
  it("returns trigger keys from a top-level component (esphome)", async () => {
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(JSON.stringify(ESPHOME_BUNDLE), { status: 200 });
    });
    const triggers = await getTriggerKeys(makeApi() as never, "esphome", "esphome");
    expect(triggers.map((t) => t.key).sort()).toEqual([
      "on_boot",
      "on_loop",
      "on_shutdown",
    ]);
    // Docs flow through when present.
    expect(triggers.find((t) => t.key === "on_boot")?.docs).toBe(
      "Run when device boots",
    );
  });

  it("returns trigger keys from a platform-style component (binary_sensor.gpio)", async () => {
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(JSON.stringify(SENSOR_BUNDLE), { status: 200 });
    });
    const triggers = await getTriggerKeys(
      makeApi() as never,
      "binary_sensor",
      "binary_sensor.gpio",
    );
    expect(triggers.map((t) => t.key).sort()).toEqual(["on_press", "on_release"]);
  });

  it("returns [] when the bundle fails to load (graceful degradation)", async () => {
    fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"));
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const triggers = await getTriggerKeys(makeApi() as never, "esphome", "esphome");
    expect(triggers).toEqual([]);
    debugSpy.mockRestore();
  });

  it("returns [] when the component key isn't in the bundle", async () => {
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(JSON.stringify(ESPHOME_BUNDLE), { status: 200 });
    });
    const triggers = await getTriggerKeys(makeApi() as never, "esphome", "nope");
    expect(triggers).toEqual([]);
  });

  it("returns [] when the component has no trigger config-vars", async () => {
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(
        JSON.stringify({
          plain: {
            schemas: {
              CONFIG_SCHEMA: {
                type: "schema",
                schema: { config_vars: { foo: { type: "string" } } },
              },
            },
          },
        }),
        { status: 200 },
      );
    });
    const triggers = await getTriggerKeys(makeApi() as never, "plain", "plain");
    expect(triggers).toEqual([]);
  });
});

const LOGGER_BUNDLE = {
  logger: {
    schemas: {
      CONFIG_SCHEMA: {
        type: "schema",
        schema: { config_vars: { level: { type: "enum", values: {} } } },
      },
    },
    action: {
      log: { type: "schema", docs: "Log a message" },
      set_level: { type: "schema" },
    },
  },
};

const LIGHT_BUNDLE = {
  light: {
    action: {
      // Component file under ``light/`` registers an action named
      // ``turn_on``. Legacy reverses the dotted form so the user
      // sees ``light.turn_on``.
      turn_on: { type: "schema", docs: "Turn the light on" },
      turn_off: { type: "schema" },
    },
  },
};

const CORE_BUNDLE = {
  // ``core`` actions stay un-prefixed: ``delay``, ``if``, ``lambda``.
  core: {
    action: {
      delay: { type: "schema", docs: "Wait before continuing" },
      if: { type: "schema" },
    },
  },
};

describe("getActions", () => {
  it("aggregates actions across the requested bundles", async () => {
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      if (url.includes("logger.json"))
        return new Response(JSON.stringify(LOGGER_BUNDLE), { status: 200 });
      if (url.includes("light.json"))
        return new Response(JSON.stringify(LIGHT_BUNDLE), { status: 200 });
      throw new Error(`unexpected fetch ${url}`);
    });
    const actions = await getActions(makeApi() as never, ["logger", "light"]);
    const keys = actions.map((a) => a.key).sort();
    expect(keys).toEqual([
      "light.turn_off",
      "light.turn_on",
      "logger.log",
      "logger.set_level",
    ]);
    expect(actions.find((a) => a.key === "logger.log")?.docs).toBe(
      "Log a message",
    );
  });

  it("emits core actions without a domain prefix", async () => {
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(JSON.stringify(CORE_BUNDLE), { status: 200 });
    });
    const actions = await getActions(makeApi() as never, ["core"]);
    expect(actions.map((a) => a.key).sort()).toEqual(["delay", "if"]);
  });

  it("returns [] when every bundle fails to load (graceful degradation)", async () => {
    fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"));
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const actions = await getActions(makeApi() as never, ["logger", "light"]);
    expect(actions).toEqual([]);
    debugSpy.mockRestore();
  });

  it("dedupes actions when the same component appears under two bundles", async () => {
    // Both bundles carry the same ``logger.log`` action — the
    // aggregator should not list it twice.
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(JSON.stringify(LOGGER_BUNDLE), { status: 200 });
    });
    const actions = await getActions(makeApi() as never, ["logger", "logger"]);
    expect(actions.filter((a) => a.key === "logger.log").length).toBe(1);
  });
});

describe("fetchBundle (negative cache eviction)", () => {
  it("evicts a failed lookup so the next caller retries", async () => {
    let attempt = 0;
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      attempt += 1;
      if (attempt === 1) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify(ESPHOME_BUNDLE), { status: 200 });
    });
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const first = await fetchBundle(makeApi() as never, "esphome");
    expect(first).toBeNull();
    // The second call should NOT see the cached null — it should
    // fire a fresh fetch (the cache evicted the failed entry) and
    // get the now-successful response.
    const second = await fetchBundle(makeApi() as never, "esphome");
    expect(second).not.toBeNull();
    debugSpy.mockRestore();
  });
});
