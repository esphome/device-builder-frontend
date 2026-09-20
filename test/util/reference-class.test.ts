import { describe, expect, it } from "vitest";
import type { ComponentCatalogIndexEntry } from "../../src/api/types/components.js";
import { findReferenceCandidates } from "../../src/util/config-entry-yaml-scan.js";
import { classCandidates, noneMatchClass } from "../../src/util/reference-class.js";
import { makeComponentEntry } from "./_make-component-entry.js";
import { makeConfigEntry } from "./_make-config-entry.js";

const index = (...entries: ComponentCatalogIndexEntry[]) =>
  new Map(entries.map((e) => [e.id, e]));

const reference = (domain: string, cls: string | null) =>
  makeConfigEntry({
    key: `${domain}_id`,
    references_component: domain,
    references_class: cls,
  });

const offered = (
  yaml: string,
  domain: string,
  cls: string | null,
  byId: ReadonlyMap<string, ComponentCatalogIndexEntry> | null,
  providers: Parameters<typeof findReferenceCandidates>[2] = []
) =>
  classCandidates(
    yaml,
    findReferenceCandidates(yaml, domain, providers),
    reference(domain, cls),
    byId
  ).map((c) => c.id);

describe("classCandidates", () => {
  const OUTPUTS = [
    "output:",
    "  - platform: gpio",
    "    id: relay_out",
    "  - platform: ledc",
    "    id: pwm_out",
    "  - platform: mystery",
    "    id: unknown_out",
    "",
  ].join("\n");
  const byId = index(
    makeComponentEntry("output.gpio", { id_classes: ["output::BinaryOutput"] }),
    // ledc satisfies every reference, so the catalog sends it no classes.
    makeComponentEntry("output.ledc")
  );

  it("drops only a block whose known classes lack the required one", () => {
    expect(offered(OUTPUTS, "output", "output::FloatOutput", byId)).toEqual([
      "pwm_out",
      "unknown_out",
    ]);
  });

  it("keeps everything until the catalog index has loaded", () => {
    expect(offered(OUTPUTS, "output", "output::FloatOutput", null)).toHaveLength(3);
  });

  it("keeps everything for a reference without a class", () => {
    expect(offered(OUTPUTS, "output", null, byId)).toHaveLength(3);
  });
});

describe("classCandidates on a typed hub", () => {
  const byId = index(
    makeComponentEntry("modbus", {
      // The default variant's classes: what a block with no ``role:`` declares.
      id_classes: ["modbus::ModbusClientHub"],
      id_classes_by_variant: {
        role: {
          client: ["modbus::ModbusClientHub"],
          server: ["modbus::ModbusServerHub"],
        },
      },
    })
  );
  const HUBS = [
    "modbus:",
    "  - id: client_hub",
    "  - id: server_hub",
    "    role: server",
    "  - id: explicit_client",
    "    role: client",
    "",
  ].join("\n");

  it("offers only the server hub to a reference that needs one", () => {
    expect(offered(HUBS, "modbus", "modbus::ModbusServerHub", byId)).toEqual([
      "server_hub",
    ]);
  });

  it("offers the default and the explicit client hubs to a client reference", () => {
    expect(offered(HUBS, "modbus", "modbus::ModbusClientHub", byId)).toEqual([
      "client_hub",
      "explicit_client",
    ]);
  });

  it.each([
    ["a substituted role", "modbus:\n  - id: hub\n    role: ${modbus_role}\n"],
    ["a role the catalog doesn't know", "modbus:\n  - id: hub\n    role: gateway\n"],
    [
      "a role named like an Object member",
      "modbus:\n  - id: hub\n    role: constructor\n",
    ],
    ["keys merged from an anchor", "modbus:\n  - id: hub\n    <<: *modbus_defaults\n"],
    ["an included block", "modbus:\n  - id: hub\n    settings: !include hub.yaml\n"],
  ])("keeps a hub it cannot judge: %s", (_label, yaml) => {
    expect(offered(yaml, "modbus", "modbus::ModbusServerHub", byId)).toEqual(["hub"]);
  });
});

describe("noneMatchClass", () => {
  const byId = index(
    makeComponentEntry("modbus", {
      id_classes: ["modbus::ModbusClientHub"],
      id_classes_by_variant: {
        role: {
          client: ["modbus::ModbusClientHub"],
          server: ["modbus::ModbusServerHub"],
        },
      },
    })
  );
  const server = reference("modbus", "modbus::ModbusServerHub");

  it.each([
    ["an id-less block of the wrong variant", "modbus:\n  role: client\n", true],
    ["an id-less block on the default variant", "modbus:\n  uart_id: bus\n", true],
    ["an id-less block of the right variant", "modbus:\n  role: server\n", false],
    ["no block at all", "logger:\n", false],
    [
      "a merged source that may hold a match",
      "packages:\n  base: !include base.yaml\nmodbus:\n  role: client\n",
      false,
    ],
  ])("%s", (_label, yaml, expected) => {
    expect(noneMatchClass(yaml, [], server, byId)).toBe(expected);
  });

  it("counts an id-less block of the right variant beside a failing id", () => {
    const yaml = "modbus:\n  - id: a\n  - role: server\n    uart_id: bus\n";
    expect(noneMatchClass(yaml, [{ id: "a" }], server, byId)).toBe(false);
  });

  it.each([
    ["a flow sequence", "modbus: [{ uart_id: bus, role: server }]\n"],
    ["a flow mapping", "modbus: { uart_id: bus, role: server }\n"],
    ["a flow mapping list item", "modbus:\n  - { uart_id: bus, role: server }\n"],
    ["a whole-value alias", "modbus: *server_hub\n"],
  ])("cannot judge %s", (_label, yaml) => {
    expect(noneMatchClass(yaml, [], server, byId)).toBe(false);
  });

  it("cannot judge a block whose keys merge inside a flow mapping", () => {
    const yaml = "modbus: [{ <<: *defaults, uart_id: bus }]\n";
    expect(noneMatchClass(yaml, [], server, byId)).toBe(false);
  });

  it("is true when every offered id fails, false once one passes", () => {
    const yaml = "modbus:\n  - id: a\n  - id: b\n    role: server\n";
    expect(noneMatchClass(yaml, [{ id: "a" }], server, byId)).toBe(true);
    expect(noneMatchClass(yaml, [{ id: "a" }, { id: "b" }], server, byId)).toBe(false);
  });
});

describe("classCandidates on a hub with more than one discriminator", () => {
  it("keeps the hub: only a single discriminator can be judged", () => {
    const byId = index(
      makeComponentEntry("modbus", {
        id_classes: ["modbus::ModbusClientHub"],
        id_classes_by_variant: {
          role: { server: ["modbus::ModbusServerHub"] },
          mode: { rtu: ["modbus::ModbusClientHub"] },
        },
      })
    );
    const yaml = "modbus:\n  - id: hub\n    role: server\n    mode: rtu\n";
    expect(offered(yaml, "modbus", "modbus::ModbusClientHub", byId)).toEqual(["hub"]);
  });
});

describe("classCandidates leaves nested interface ids alone", () => {
  it("keeps a multi-entity platform's sub-entity id", () => {
    const yaml = [
      "sensor:",
      "  - platform: dht",
      "    id: dht_hub",
      "    temperature:",
      "      id: room_temp",
      "",
    ].join("\n");
    const byId = index(makeComponentEntry("sensor.dht", { id_classes: ["dht::DHT"] }));
    const providers = [
      { domain: "sensor", stem: "dht", idPaths: [["temperature", "id"]] },
    ];
    expect(offered(yaml, "sensor", "sensor::Sensor", byId, providers)).toEqual([
      "room_temp",
    ]);
  });
});
