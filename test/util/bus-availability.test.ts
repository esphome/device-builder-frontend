import { beforeEach, describe, expect, it } from "vitest";

import {
  assessBusHostability,
  exclusiveBusTarget,
  type BusConstraintsLookup,
} from "../../src/util/bus-availability.js";
import { _clearYamlSectionsMemo } from "../../src/util/yaml-sections-core.js";

const RX_9600 = { baud_rate: 9600, require_rx: true, data_bits: 8, stop_bits: 1 };
const TX_9600 = { baud_rate: 9600, require_tx: true };

/** Catalog lookup covering the components the fixtures configure. */
const lookup: BusConstraintsLookup = (id) =>
  ({
    "sensor.a02yyuw": { uart: RX_9600 },
    "sensor.a01nyub": { uart: RX_9600 },
    dfplayer: { uart: TX_9600 },
  })[id];

const ONE_BUS =
  "uart:\n  - baud_rate: 9600\n    rx_pin: 44\n    tx_pin: 43\n    id: uart_1\n";

const RX_CONSUMER =
  "sensor:\n  - platform: a02yyuw\n    name: Level\n    uart_id: uart_1\n";

beforeEach(() => _clearYamlSectionsMemo());

describe("assessBusHostability", () => {
  it("reports no buses when the domain is absent", () => {
    expect(assessBusHostability("wifi:\n  ssid: x\n", "uart", RX_9600, lookup)).toEqual({
      busCount: 0,
      compatibleIds: [],
    });
  });

  it("hosts on an unclaimed bus", () => {
    expect(assessBusHostability(ONE_BUS, "uart", RX_9600, lookup)).toEqual({
      busCount: 1,
      compatibleIds: ["uart_1"],
    });
  });

  it("refuses the sole bus when its rx is already claimed (issue #2453)", () => {
    expect(assessBusHostability(ONE_BUS + RX_CONSUMER, "uart", RX_9600, lookup)).toEqual({
      busCount: 1,
      compatibleIds: [],
    });
  });

  it("claims via implicit attachment when the consumer omits uart_id", () => {
    const yaml = ONE_BUS + "sensor:\n  - platform: a02yyuw\n    name: Level\n";
    expect(assessBusHostability(yaml, "uart", RX_9600, lookup).compatibleIds).toEqual([]);
  });

  it("lets an rx reader join a bus a tx-only writer claims", () => {
    const yaml = ONE_BUS + "dfplayer:\n  uart_id: uart_1\n";
    expect(assessBusHostability(yaml, "uart", RX_9600, lookup).compatibleIds).toEqual([
      "uart_1",
    ]);
  });

  it("ignores a consumer with no captured constraints (modbus-style)", () => {
    const yaml = ONE_BUS + "modbus:\n  uart_id: uart_1\n";
    expect(assessBusHostability(yaml, "uart", RX_9600, lookup).compatibleIds).toEqual([
      "uart_1",
    ]);
  });

  it("refuses a bus whose baud diverges from the candidate's", () => {
    const yaml = "uart:\n  - baud_rate: 115200\n    rx_pin: 44\n    id: uart_1\n";
    expect(assessBusHostability(yaml, "uart", RX_9600, lookup).compatibleIds).toEqual([]);
  });

  it("accepts a choice-list constraint when the bus matches one choice", () => {
    const yaml = "uart:\n  - baud_rate: 2400\n    rx_pin: 44\n    id: uart_1\n";
    const candidate = { baud_rate: [2400, 9600], require_rx: true };
    expect(assessBusHostability(yaml, "uart", candidate, lookup).compatibleIds).toEqual([
      "uart_1",
    ]);
  });

  it("treats a substituted bus setting as unknown and matches it", () => {
    const yaml = "uart:\n  - baud_rate: ${baud}\n    rx_pin: 44\n    id: uart_1\n";
    expect(assessBusHostability(yaml, "uart", RX_9600, lookup).compatibleIds).toEqual([
      "uart_1",
    ]);
  });

  it("applies esphome defaults to omitted settings", () => {
    const candidate = { ...RX_9600, parity: "EVEN" };
    expect(
      assessBusHostability(ONE_BUS, "uart", candidate, lookup).compatibleIds
    ).toEqual([]);
  });

  it("refuses a bus missing the pin the candidate requires", () => {
    const yaml = "uart:\n  - baud_rate: 9600\n    tx_pin: 43\n    id: uart_1\n";
    expect(assessBusHostability(yaml, "uart", RX_9600, lookup).compatibleIds).toEqual([]);
  });

  it("routes claims through an explicit uart_id and keeps the other bus free", () => {
    const yaml =
      "uart:\n" +
      "  - baud_rate: 9600\n    rx_pin: 44\n    id: uart_1\n" +
      "  - baud_rate: 9600\n    rx_pin: 6\n    id: uart_2\n" +
      RX_CONSUMER;
    expect(assessBusHostability(yaml, "uart", RX_9600, lookup)).toEqual({
      busCount: 2,
      compatibleIds: ["uart_2"],
    });
  });

  it("claims nothing for an ambiguous consumer on a multi-bus config", () => {
    const yaml =
      "uart:\n" +
      "  - baud_rate: 9600\n    rx_pin: 44\n    id: uart_1\n" +
      "  - baud_rate: 9600\n    rx_pin: 6\n    id: uart_2\n" +
      "sensor:\n  - platform: a02yyuw\n    name: Level\n";
    expect(assessBusHostability(yaml, "uart", RX_9600, lookup).compatibleIds).toEqual([
      "uart_1",
      "uart_2",
    ]);
  });

  it("reads a singleton mapping bus and reports its null id", () => {
    const yaml = "uart:\n  baud_rate: 9600\n  rx_pin: 44\n";
    expect(assessBusHostability(yaml, "uart", RX_9600, lookup)).toEqual({
      busCount: 1,
      compatibleIds: [null],
    });
  });

  it("treats an anchor-merged bus block as unknown, not pinless", () => {
    const yaml =
      ".uart_base: &uart_base\n  baud_rate: 9600\n  rx_pin: 44\n" +
      "uart:\n  - <<: *uart_base\n    id: uart_1\n";
    expect(assessBusHostability(yaml, "uart", RX_9600, lookup).compatibleIds).toEqual([
      "uart_1",
    ]);
  });

  it("treats a flow-mapping bus item as unknown, not pinless", () => {
    const yaml = "uart:\n  - { baud_rate: 115200, rx_pin: 44, id: uart_1 }\n";
    expect(assessBusHostability(yaml, "uart", RX_9600, lookup).busCount).toBe(1);
    expect(
      assessBusHostability(yaml, "uart", RX_9600, lookup).compatibleIds
    ).toHaveLength(1);
  });

  it("fails open for a domain without registered semantics", () => {
    const yaml = "i2c:\n  - sda: 8\n    scl: 9\n    id: bus_a\n";
    expect(assessBusHostability(yaml, "i2c", { max_frequency: 15000 }, lookup)).toEqual({
      busCount: 1,
      compatibleIds: ["bus_a"],
    });
  });

  it("skips pin exclusivity on the host platform", () => {
    const yaml = "host:\n" + ONE_BUS + RX_CONSUMER;
    expect(assessBusHostability(yaml, "uart", RX_9600, lookup).compatibleIds).toEqual([
      "uart_1",
    ]);
  });
});

describe("exclusiveBusTarget", () => {
  it("targets a uart dependency the entry also constrains", () => {
    const entry = { dependencies: ["uart"], bus_constraints: { uart: RX_9600 } };
    expect(exclusiveBusTarget(entry)).toEqual({ domain: "uart", constraints: RX_9600 });
  });

  it("ignores non-exclusive buses and unconstrained deps", () => {
    expect(
      exclusiveBusTarget({
        dependencies: ["i2c"],
        bus_constraints: { i2c: { max_frequency: 15000 } },
      })
    ).toBeNull();
    expect(exclusiveBusTarget({ dependencies: ["uart"] })).toBeNull();
    expect(exclusiveBusTarget({})).toBeNull();
  });
});
