/** Unit tests for `configNeedsMigration`. */
import { describe, expect, it } from "vitest";

import { configNeedsMigration } from "../../src/util/config-migrations.js";

describe("configNeedsMigration", () => {
  it.each([
    [
      "legacy api services block",
      "api:\n  services:\n    - service: pause\n      then:\n        - logger.log: hi\n",
      true,
    ],
    [
      "legacy item under a canonical actions block",
      "api:\n  actions:\n    - service: pause\n      then:\n        - logger.log: hi\n",
      true,
    ],
    [
      "fully canonical api block",
      "api:\n  actions:\n    - action: pause\n      then:\n        - logger.log: hi\n",
      false,
    ],
    [
      "homeassistant.service node id",
      "esphome:\n  on_boot:\n    then:\n      - homeassistant.service:\n          action: light.on\n",
      true,
    ],
    [
      "legacy service field inside homeassistant.action",
      "script:\n  - id: s\n    then:\n      - homeassistant.action:\n          service: light.on\n",
      true,
    ],
    [
      "legacy field in a flow-style body",
      "esphome:\n  on_boot:\n    then:\n      - homeassistant.action: {service: light.on}\n",
      true,
    ],
    [
      "flow-nested payload decoy",
      "esphome:\n  on_boot:\n    then:\n      - homeassistant.action: {action: notify, data: {service: decoy}}\n",
      false,
    ],
    [
      "flow legacy field beside a nested canonical decoy",
      "esphome:\n  on_boot:\n    then:\n      - homeassistant.action: {data: {action: decoy}, service: light.on}\n",
      true,
    ],
    [
      "comment lines in the node body",
      "esphome:\n  on_boot:\n    then:\n      - homeassistant.action:\n        # call the light service\n          service: light.on\n",
      true,
    ],
    [
      "collision the migration would skip",
      "esphome:\n  on_boot:\n    then:\n      - homeassistant.action:\n          action: a\n          service: b\n",
      false,
    ],
    [
      "anchor inside a block scalar",
      "esphome:\n  on_boot:\n    then:\n      - lambda: |-\n          homeassistant.service: not_yaml\n",
      false,
    ],
    [
      "deeper service key inside the node body",
      "script:\n  - id: s\n    then:\n      - homeassistant.action:\n          action: notify\n          data:\n            service: decoy\n",
      false,
    ],
    [
      "ethernet clk_mode with a decodable value",
      "ethernet:\n  type: LAN8720\n  clk_mode: GPIO0_IN\n",
      true,
    ],
    [
      "ethernet clk_mode with an undecodable value",
      "ethernet:\n  type: LAN8720\n  clk_mode: !secret clk\n",
      false,
    ],
    ["ethernet already on clk", "ethernet:\n  clk:\n    pin: GPIO0\n", false],
    ["empty buffer", "", false],
    ["unrelated config", "logger:\n  level: DEBUG\n", false],
    ["comment decoy", "web_server:\n  # service: comment decoy\n", false],
  ])("%s", (_name, yaml, expected) => {
    expect(configNeedsMigration(yaml)).toBe(expected);
  });
});
