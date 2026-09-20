import { describe, expect, it } from "vitest";
import type { ComponentCatalogIndexEntry } from "../../src/api/types/components.js";
import {
  findReferenceCandidates,
  referenceClassFilter,
} from "../../src/util/config-entry-yaml-scan.js";
import { makeComponentEntry } from "./_make-component-entry.js";
import { makeConfigEntry } from "./_make-config-entry.js";

const index = (...entries: ComponentCatalogIndexEntry[]) =>
  new Map(entries.map((e) => [e.id, e]));

const ids = (list: Array<{ id: string }>) => list.map((c) => c.id);

describe("findReferenceCandidates with a required id class", () => {
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
  const floatRef = makeConfigEntry({
    key: "output",
    references_component: "output",
    references_class: "output::FloatOutput",
  });
  const byId = index(
    makeComponentEntry("output.gpio", { id_classes: ["output::BinaryOutput"] }),
    // ledc satisfies every reference, so the catalog sends it no classes.
    makeComponentEntry("output.ledc")
  );

  it("drops only a block whose known classes lack the required one", () => {
    const filter = referenceClassFilter(floatRef, byId);
    expect(ids(findReferenceCandidates(OUTPUTS, "output", [], filter))).toEqual([
      "pwm_out",
      "unknown_out",
    ]);
  });

  it("keeps everything until the catalog index has loaded", () => {
    const filter = referenceClassFilter(floatRef, null);
    expect(ids(findReferenceCandidates(OUTPUTS, "output", [], filter))).toHaveLength(3);
  });

  it("builds no filter for a reference without a class", () => {
    const plain = makeConfigEntry({ key: "output", references_component: "output" });
    expect(referenceClassFilter(plain, byId)).toBeUndefined();
  });

  it("does not reuse a scan memoised before the index loaded", () => {
    const before = findReferenceCandidates(
      OUTPUTS,
      "output",
      [],
      referenceClassFilter(floatRef, null)
    );
    const after = findReferenceCandidates(
      OUTPUTS,
      "output",
      [],
      referenceClassFilter(floatRef, byId)
    );
    expect(before).toHaveLength(3);
    expect(after).toHaveLength(2);
  });
});

describe("a typed hub is judged by the block's own variant", () => {
  const HUBS = [
    "modbus:",
    "  - id: client_hub",
    "  - id: server_hub",
    "    role: server",
    "  - id: explicit_client",
    "    role: client",
    "",
  ].join("\n");
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
  const ref = (cls: string) =>
    referenceClassFilter(
      makeConfigEntry({
        key: "modbus_id",
        references_component: "modbus",
        references_class: cls,
      }),
      byId
    );

  it("offers only the server hub to a reference that needs one", () => {
    expect(
      ids(findReferenceCandidates(HUBS, "modbus", [], ref("modbus::ModbusServerHub")))
    ).toEqual(["server_hub"]);
  });

  it("offers the default and the explicit client hubs to a client reference", () => {
    expect(
      ids(findReferenceCandidates(HUBS, "modbus", [], ref("modbus::ModbusClientHub")))
    ).toEqual(["client_hub", "explicit_client"]);
  });
});

describe("nested interface ids are never class filtered", () => {
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
    const filter = referenceClassFilter(
      makeConfigEntry({
        key: "sensor",
        references_component: "sensor",
        references_class: "sensor::Sensor",
      }),
      byId
    );
    const providers = [
      { domain: "sensor", stem: "dht", idPaths: [["temperature", "id"]] },
    ];
    expect(ids(findReferenceCandidates(yaml, "sensor", providers, filter))).toEqual([
      "room_temp",
    ]);
  });
});
