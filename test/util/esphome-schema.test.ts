import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetSchemaCacheForTests,
  fetchBundle,
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
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
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
