import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetSchemaCacheForTests,
  fetchBundle,
  getActions,
  getConfigVarKeys,
  getConfigVarValueOptions,
  getRegistryEntries,
  getRegistryEntryKeys,
  getTriggerKeys,
  lookupRegistryRef,
  parseRegistryLabel,
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
    expect(
      bundle?.esphome?.schemas?.CONFIG_SCHEMA?.schema.config_vars.on_boot
    ).toBeDefined();
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
      (c) => (c[1] as RequestInit | undefined)?.method !== "HEAD"
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
    expect(triggers.find((t) => t.key === "on_boot")?.docs).toBe("Run when device boots");
  });

  it("returns trigger keys from a platform-style component (binary_sensor.gpio)", async () => {
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(JSON.stringify(SENSOR_BUNDLE), { status: 200 });
    });
    const triggers = await getTriggerKeys(
      makeApi() as never,
      "binary_sensor",
      "binary_sensor.gpio"
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
        { status: 200 }
      );
    });
    const triggers = await getTriggerKeys(makeApi() as never, "plain", "plain");
    expect(triggers).toEqual([]);
  });

  it("follows the extends chain into a sibling bundle", async () => {
    // Mirrors the live shape: ``gpio.binary_sensor.CONFIG_SCHEMA``
    // extends ``binary_sensor._BINARY_SENSOR_SCHEMA``, where the
    // shared triggers (``on_press`` / ``on_release`` / etc.)
    // actually live. ``getTriggerKeys`` should follow that chain
    // and surface the triggers even though they're not local to
    // ``gpio.binary_sensor``.
    const GPIO_BUNDLE = {
      "gpio.binary_sensor": {
        schemas: {
          CONFIG_SCHEMA: {
            type: "schema",
            schema: {
              extends: ["binary_sensor._BINARY_SENSOR_SCHEMA"],
              config_vars: { pin: { type: "pin" } },
            },
          },
        },
      },
    };
    const BINARY_SENSOR_BUNDLE = {
      binary_sensor: {
        schemas: {
          _BINARY_SENSOR_SCHEMA: {
            type: "schema",
            schema: {
              config_vars: {
                on_press: { type: "trigger", docs: "Pressed" },
                on_release: { type: "trigger" },
              },
            },
          },
        },
      },
    };
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      if (url.includes("gpio.json"))
        return new Response(JSON.stringify(GPIO_BUNDLE), { status: 200 });
      if (url.includes("binary_sensor.json"))
        return new Response(JSON.stringify(BINARY_SENSOR_BUNDLE), {
          status: 200,
        });
      throw new Error(`unexpected ${url}`);
    });
    const triggers = await getTriggerKeys(
      makeApi() as never,
      "gpio",
      "gpio.binary_sensor"
    );
    expect(triggers.map((t) => t.key).sort()).toEqual(["on_press", "on_release"]);
    expect(triggers.find((t) => t.key === "on_press")?.docs).toBe("Pressed");
  });

  it("dedupes triggers across the extends chain", async () => {
    // Local override + parent schema both declare ``on_state``;
    // surface only one entry (local wins, since we add it first).
    const BUNDLE = {
      child: {
        schemas: {
          CONFIG_SCHEMA: {
            type: "schema",
            schema: {
              extends: ["child._BASE"],
              config_vars: {
                on_state: { type: "trigger", docs: "child" },
              },
            },
          },
          _BASE: {
            type: "schema",
            schema: {
              config_vars: {
                on_state: { type: "trigger", docs: "parent" },
                on_value: { type: "trigger" },
              },
            },
          },
        },
      },
    };
    fetchSpy.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(JSON.stringify(BUNDLE), { status: 200 });
    });
    const triggers = await getTriggerKeys(makeApi() as never, "child", "child");
    expect(triggers.map((t) => t.key).sort()).toEqual(["on_state", "on_value"]);
    expect(triggers.find((t) => t.key === "on_state")?.docs).toBe("child");
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
    const actions = await getActions(
      makeApi() as never,
      ["logger", "light"],
      ["logger", "light"]
    );
    const keys = actions.map((a) => a.key).sort();
    expect(keys).toEqual([
      "light.turn_off",
      "light.turn_on",
      "logger.log",
      "logger.set_level",
    ]);
    expect(actions.find((a) => a.key === "logger.log")?.docs).toBe("Log a message");
  });

  it("emits core actions without a domain prefix", async () => {
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(JSON.stringify(CORE_BUNDLE), { status: 200 });
    });
    const actions = await getActions(makeApi() as never, ["core"], ["core"]);
    expect(actions.map((a) => a.key).sort()).toEqual(["delay", "if"]);
  });

  it("returns [] when every bundle fails to load (graceful degradation)", async () => {
    fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"));
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const actions = await getActions(
      makeApi() as never,
      ["logger", "light"],
      ["logger", "light"]
    );
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
    const actions = await getActions(
      makeApi() as never,
      ["logger", "logger"],
      ["logger"]
    );
    expect(actions.filter((a) => a.key === "logger.log").length).toBe(1);
  });

  it("filters out components not in the wanted-keys set", async () => {
    // Bundle carries entries for both ``logger`` and ``ignored``;
    // only ``logger`` is in the wanted set, so ``ignored.foo``
    // should not appear. Mirrors the doc-scoped filtering the
    // legacy editor used (only suggest actions from components
    // actually present in the YAML).
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(
        JSON.stringify({
          ...LOGGER_BUNDLE,
          ignored: {
            action: { foo: { type: "schema" } },
          },
        }),
        { status: 200 }
      );
    });
    const actions = await getActions(makeApi() as never, ["logger"], ["logger"]);
    expect(actions.map((a) => a.key)).not.toContain("ignored.foo");
    expect(actions.map((a) => a.key).sort()).toEqual(["logger.log", "logger.set_level"]);
  });
});

describe("getConfigVarKeys", () => {
  // Scenario this exists for: ``sensor.uptime`` ships an empty
  // ``config_entries`` list in the prebuilt catalog (the
  // backend's schema sync doesn't fully expand
  // ``cv.typed_schema`` + ``extends`` for these). The schema
  // bundle on ``schema.esphome.io`` is the authoritative source
  // — typing ``nam`` under ``- platform: uptime`` should still
  // surface ``name``, ``device_class``, etc.
  it("expands a cv.typed_schema and unions every variant's config_vars", async () => {
    const UPTIME_BUNDLE = {
      "uptime.sensor": {
        schemas: {
          CONFIG_SCHEMA: {
            type: "typed",
            typed_key: "type",
            types: {
              seconds: {
                config_vars: {
                  accuracy_decimals: { default: "0" },
                  update_interval: { default: "60s", key: "Optional" },
                },
                extends: ["sensor._SENSOR_SCHEMA"],
              },
              timestamp: {
                config_vars: {
                  time_id: { type: "use_id", key: "GeneratedID" },
                },
                extends: ["sensor._SENSOR_SCHEMA"],
              },
            },
          },
        },
      },
    };
    const SENSOR_SCHEMA_BUNDLE = {
      sensor: {
        schemas: {
          _SENSOR_SCHEMA: {
            type: "schema",
            schema: {
              config_vars: {
                name: { type: "string", key: "Required" },
                icon: { type: "string", key: "Optional" },
                device_class: { type: "enum", key: "Optional" },
                unit_of_measurement: { type: "string", key: "Optional" },
              },
            },
          },
        },
      },
    };
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      if (url.includes("uptime.json"))
        return new Response(JSON.stringify(UPTIME_BUNDLE), { status: 200 });
      if (url.includes("sensor.json"))
        return new Response(JSON.stringify(SENSOR_SCHEMA_BUNDLE), {
          status: 200,
        });
      throw new Error(`unexpected ${url}`);
    });
    const keys = await getConfigVarKeys(makeApi() as never, "uptime", "uptime.sensor");
    const labels = keys.map((k) => k.key);
    // Discriminator surfaces.
    expect(labels).toContain("type");
    // Variant-specific keys from both branches.
    expect(labels).toContain("update_interval");
    expect(labels).toContain("time_id");
    // Inherited from the extended ``sensor._SENSOR_SCHEMA``.
    expect(labels).toContain("name");
    expect(labels).toContain("device_class");
    expect(labels).toContain("icon");
    expect(labels).toContain("unit_of_measurement");
    // ``Required`` keys flag as such.
    expect(keys.find((k) => k.key === "name")?.required).toBe(true);
    expect(keys.find((k) => k.key === "icon")?.required).toBe(false);
  });

  it("walks a plain schema's extends chain", async () => {
    const CHILD_BUNDLE = {
      child: {
        schemas: {
          CONFIG_SCHEMA: {
            type: "schema",
            schema: {
              extends: ["child._BASE"],
              config_vars: { local: { type: "string" } },
            },
          },
          _BASE: {
            type: "schema",
            schema: { config_vars: { inherited: { type: "string" } } },
          },
        },
      },
    };
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(JSON.stringify(CHILD_BUNDLE), { status: 200 });
    });
    const keys = await getConfigVarKeys(makeApi() as never, "child", "child");
    expect(keys.map((k) => k.key).sort()).toEqual(["inherited", "local"]);
  });

  it("skips trigger config-vars (those are exposed by getTriggerKeys)", async () => {
    const BUNDLE = {
      thing: {
        schemas: {
          CONFIG_SCHEMA: {
            type: "schema",
            schema: {
              config_vars: {
                name: { type: "string" },
                on_press: { type: "trigger" },
              },
            },
          },
        },
      },
    };
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(JSON.stringify(BUNDLE), { status: 200 });
    });
    const keys = await getConfigVarKeys(makeApi() as never, "thing", "thing");
    expect(keys.map((k) => k.key)).toEqual(["name"]);
  });

  it("returns [] when the bundle fails to load", async () => {
    fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"));
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const keys = await getConfigVarKeys(makeApi() as never, "uptime", "uptime.sensor");
    expect(keys).toEqual([]);
    debugSpy.mockRestore();
  });
});

describe("getConfigVarValueOptions", () => {
  // Scenario: typing ``device_class: dd`` under
  // ``sensor: - platform: uptime``. The catalog has empty
  // ``config_entries`` for ``sensor.uptime``, so the regular
  // value-position lookup misses ``device_class``. The schema
  // bundle declares it as ``type: enum`` on
  // ``sensor._SENSOR_SCHEMA`` (inherited via the typed
  // variants' extends chain).
  it("walks typed_schema + extends to find an enum config-var", async () => {
    const UPTIME_BUNDLE = {
      "uptime.sensor": {
        schemas: {
          CONFIG_SCHEMA: {
            type: "typed",
            typed_key: "type",
            types: {
              seconds: {
                config_vars: { update_interval: { default: "60s" } },
                extends: ["sensor._SENSOR_SCHEMA"],
              },
            },
          },
        },
      },
    };
    const SENSOR_BUNDLE_WITH_ENUM = {
      sensor: {
        schemas: {
          _SENSOR_SCHEMA: {
            type: "schema",
            schema: {
              config_vars: {
                device_class: {
                  type: "enum",
                  values: {
                    duration: { docs: "Time elapsed" },
                    temperature: { docs: "Heat" },
                    humidity: {},
                  },
                },
              },
            },
          },
        },
      },
    };
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      if (url.includes("uptime.json"))
        return new Response(JSON.stringify(UPTIME_BUNDLE), { status: 200 });
      if (url.includes("sensor.json"))
        return new Response(JSON.stringify(SENSOR_BUNDLE_WITH_ENUM), {
          status: 200,
        });
      throw new Error(`unexpected ${url}`);
    });
    const values = await getConfigVarValueOptions(
      makeApi() as never,
      "uptime",
      "uptime.sensor",
      "device_class"
    );
    expect(values.map((v) => v.value).sort()).toEqual([
      "duration",
      "humidity",
      "temperature",
    ]);
    expect(values.find((v) => v.value === "duration")?.docs).toBe("Time elapsed");
  });

  it("returns [] when the named config-var isn't an enum", async () => {
    const BUNDLE = {
      thing: {
        schemas: {
          CONFIG_SCHEMA: {
            type: "schema",
            schema: { config_vars: { name: { type: "string" } } },
          },
        },
      },
    };
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(JSON.stringify(BUNDLE), { status: 200 });
    });
    const values = await getConfigVarValueOptions(
      makeApi() as never,
      "thing",
      "thing",
      "name"
    );
    expect(values).toEqual([]);
  });

  it("returns [] when the bundle fails to load", async () => {
    fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"));
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const values = await getConfigVarValueOptions(
      makeApi() as never,
      "uptime",
      "uptime.sensor",
      "device_class"
    );
    expect(values).toEqual([]);
    debugSpy.mockRestore();
  });
});

describe("lookupRegistryRef + getRegistryEntries", () => {
  // Scenario: typing under ``filters:`` inside a sensor item.
  // The schema declares ``filters`` as ``type: "registry"`` on
  // ``sensor._SENSOR_SCHEMA`` (inherited via the typed-schema
  // extends chain). The registry members live at
  // ``sensor.filter`` in the bundle.
  it("resolves a registry-typed config-var through the extends chain", async () => {
    const UPTIME_BUNDLE = {
      "uptime.sensor": {
        schemas: {
          CONFIG_SCHEMA: {
            type: "typed",
            typed_key: "type",
            types: {
              seconds: {
                config_vars: {},
                extends: ["sensor._SENSOR_SCHEMA"],
              },
            },
          },
        },
      },
    };
    const SENSOR_BUNDLE_WITH_FILTERS = {
      sensor: {
        schemas: {
          _SENSOR_SCHEMA: {
            type: "schema",
            schema: {
              config_vars: {
                filters: {
                  type: "registry",
                  registry: "sensor.filter",
                  is_list: true,
                },
              },
            },
          },
        },
        filter: {
          calibrate_linear: { docs: "Linear calibration" },
          clamp: { docs: "Clamp values" },
          multiply: {},
        },
      },
    };
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      if (url.includes("uptime.json"))
        return new Response(JSON.stringify(UPTIME_BUNDLE), { status: 200 });
      if (url.includes("sensor.json"))
        return new Response(JSON.stringify(SENSOR_BUNDLE_WITH_FILTERS), {
          status: 200,
        });
      throw new Error(`unexpected ${url}`);
    });
    const ref = await lookupRegistryRef(
      makeApi() as never,
      "uptime",
      "uptime.sensor",
      "filters"
    );
    expect(ref).toBe("sensor.filter");
    const entries = await getRegistryEntries(makeApi() as never, ref!);
    expect(entries.map((e) => e.key).sort()).toEqual([
      "calibrate_linear",
      "clamp",
      "multiply",
    ]);
    expect(entries.find((e) => e.key === "calibrate_linear")?.docs).toBe(
      "Linear calibration"
    );
  });

  it("propagates is_list to the schema-bundle config-var key", async () => {
    // When ``filters: { is_list: true }`` shows up in the
    // schema, ``getConfigVarKeys`` must surface ``isList: true``
    // so the completion source can switch to the list-block
    // apply snippet (``filters:\n  - ``) instead of ``key: ``.
    const BUNDLE = {
      thing: {
        schemas: {
          CONFIG_SCHEMA: {
            type: "schema",
            schema: {
              config_vars: {
                filters: {
                  type: "registry",
                  registry: "thing.filter",
                  is_list: true,
                },
                name: { type: "string" },
              },
            },
          },
        },
      },
    };
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(JSON.stringify(BUNDLE), { status: 200 });
    });
    const keys = await getConfigVarKeys(makeApi() as never, "thing", "thing");
    expect(keys.find((k) => k.key === "filters")?.isList).toBe(true);
    expect(keys.find((k) => k.key === "name")?.isList).toBe(false);
  });

  it("returns [] for a non-registry config-var", async () => {
    const BUNDLE = {
      thing: {
        schemas: {
          CONFIG_SCHEMA: {
            type: "schema",
            schema: { config_vars: { name: { type: "string" } } },
          },
        },
      },
    };
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(JSON.stringify(BUNDLE), { status: 200 });
    });
    const ref = await lookupRegistryRef(makeApi() as never, "thing", "thing", "name");
    expect(ref).toBeNull();
  });

  it("returns [] when the registry ref points at a missing slot", async () => {
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(JSON.stringify({ thing: { schemas: {} } }), { status: 200 });
    });
    const entries = await getRegistryEntries(makeApi() as never, "thing.filter");
    expect(entries).toEqual([]);
  });

  it("returns [] for a malformed registry ref (no dot)", async () => {
    const entries = await getRegistryEntries(makeApi() as never, "broken");
    expect(entries).toEqual([]);
  });
});

describe("parseRegistryLabel", () => {
  it("reverses dotted action labels back to (bundle, component, entry)", () => {
    expect(parseRegistryLabel("globals.set")).toEqual({
      bundleName: "globals",
      componentName: "globals",
      entryName: "set",
    });
    expect(parseRegistryLabel("logger.log")).toEqual({
      bundleName: "logger",
      componentName: "logger",
      entryName: "log",
    });
    expect(parseRegistryLabel("binary_sensor.is_on")).toEqual({
      bundleName: "binary_sensor",
      componentName: "binary_sensor",
      entryName: "is_on",
    });
  });

  it("treats undotted labels as core actions in the esphome bundle", () => {
    // Core actions (``delay``, ``if``, ``lambda``) live at
    // ``esphome.json[core]``: bundle ``esphome``, component ``core``.
    // ``getRegistryEntryKeys`` is bundle-keyed so the triple has
    // to distinguish them.
    expect(parseRegistryLabel("delay")).toEqual({
      bundleName: "esphome",
      componentName: "core",
      entryName: "delay",
    });
    expect(parseRegistryLabel("if")).toEqual({
      bundleName: "esphome",
      componentName: "core",
      entryName: "if",
    });
  });
});

describe("getRegistryEntryKeys", () => {
  // Scenario: cursor is at the body of ``- globals.set:`` —
  // the entries we want to suggest are the action's own
  // ``id`` / ``value`` config-vars, declared on the schema
  // bundle's ``action.set`` slot.
  it("reads config-vars from a registry entry's schema", async () => {
    const GLOBALS_BUNDLE = {
      globals: {
        action: {
          set: {
            type: "schema",
            schema: {
              config_vars: {
                id: {
                  type: "use_id",
                  key: "Required",
                  use_id_type: "globals::GlobalsComponent",
                },
                value: { type: "string", key: "Required" },
              },
            },
          },
        },
      },
    };
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(JSON.stringify(GLOBALS_BUNDLE), { status: 200 });
    });
    const keys = await getRegistryEntryKeys(
      makeApi() as never,
      "globals",
      "globals",
      "set"
    );
    expect(keys.map((k) => k.key).sort()).toEqual(["id", "value"]);
    expect(keys.find((k) => k.key === "id")?.required).toBe(true);
  });

  it("walks the extends chain on a registry entry's schema", async () => {
    const BUNDLE = {
      light: {
        action: {
          turn_on: {
            type: "schema",
            schema: {
              extends: ["light.LIGHT_ACTION_SCHEMA"],
              config_vars: { brightness: { type: "integer" } },
            },
          },
        },
        schemas: {
          LIGHT_ACTION_SCHEMA: {
            type: "schema",
            schema: {
              config_vars: {
                id: { type: "use_id", key: "Required" },
                transition_length: { type: "string" },
              },
            },
          },
        },
      },
    };
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(JSON.stringify(BUNDLE), { status: 200 });
    });
    const keys = await getRegistryEntryKeys(
      makeApi() as never,
      "light",
      "light",
      "turn_on"
    );
    expect(keys.map((k) => k.key).sort()).toEqual([
      "brightness",
      "id",
      "transition_length",
    ]);
  });

  it("returns [] for a missing registry entry", async () => {
    const BUNDLE = { thing: { action: {} } };
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(JSON.stringify(BUNDLE), { status: 200 });
    });
    const keys = await getRegistryEntryKeys(
      makeApi() as never,
      "thing",
      "thing",
      "missing"
    );
    expect(keys).toEqual([]);
  });

  it("reads core actions from the esphome bundle's core slot", async () => {
    // Core actions (``delay``, ``if``, ``lambda``, …) live at
    // ``esphome.json[core].action.<name>`` — bundle and component
    // differ. The fetcher must take both separately.
    const ESPHOME_BUNDLE = {
      core: {
        action: {
          delay: {
            type: "schema",
            schema: { config_vars: { time: { type: "string" } } },
          },
        },
      },
    };
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return new Response(JSON.stringify(ESPHOME_BUNDLE), { status: 200 });
    });
    const keys = await getRegistryEntryKeys(
      makeApi() as never,
      "esphome",
      "core",
      "delay"
    );
    expect(keys.map((k) => k.key)).toEqual(["time"]);
  });
});

describe("resolveVersion (probe failure handling)", () => {
  it("evicts the cached version when the probe returns a transient 5xx", async () => {
    // Copilot-flagged: ``probe.ok ? esphome_version : "dev"`` made
    // any non-2xx (including 5xx) silently downgrade to ``dev`` for
    // the page lifetime. Pin the new behaviour: 5xx evicts the
    // cached version so a later caller can retry once conditions
    // recover.
    let probeAttempts = 0;
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        probeAttempts += 1;
        if (probeAttempts === 1) return new Response(null, { status: 503 });
        return new Response(null, { status: 200 });
      }
      if (url.includes("/2026.5.0/esphome.json"))
        return new Response(JSON.stringify(ESPHOME_BUNDLE), { status: 200 });
      throw new Error(`unexpected ${url}`);
    });
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const first = await fetchBundle(makeApi() as never, "esphome");
    expect(first).toBeNull();
    const second = await fetchBundle(makeApi() as never, "esphome");
    expect(second).not.toBeNull();
    expect(probeAttempts).toBe(2);
    debugSpy.mockRestore();
  });

  it("treats a 404 probe as a stable 'dev' signal (no retries)", async () => {
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 404 });
      if (url.includes("/dev/esphome.json"))
        return new Response(JSON.stringify(ESPHOME_BUNDLE), { status: 200 });
      throw new Error(`unexpected ${url}`);
    });
    const bundle = await fetchBundle(makeApi() as never, "esphome");
    expect(bundle).not.toBeNull();
    await fetchBundle(makeApi() as never, "esphome");
    const heads = fetchSpy.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "HEAD"
    );
    expect(heads.length).toBe(1);
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
