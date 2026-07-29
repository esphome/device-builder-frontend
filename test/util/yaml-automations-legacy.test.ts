/** Unit tests for `hasLegacyAutomationSpellings`. */
import { describe, expect, it } from "vitest";

import { hasLegacyAutomationSpellings } from "../../src/util/yaml-automations-legacy.js";

describe("hasLegacyAutomationSpellings", () => {
  it("flags a legacy api services block", () => {
    expect(
      hasLegacyAutomationSpellings(
        "api:\n  services:\n    - service: pause\n      then:\n        - logger.log: hi\n"
      )
    ).toBe(true);
  });

  it("flags a legacy item under a canonical actions block", () => {
    expect(
      hasLegacyAutomationSpellings(
        "api:\n  actions:\n    - service: pause\n      then:\n        - logger.log: hi\n"
      )
    ).toBe(true);
  });

  it("passes a fully canonical api block", () => {
    expect(
      hasLegacyAutomationSpellings(
        "api:\n  actions:\n    - action: pause\n      then:\n        - logger.log: hi\n"
      )
    ).toBe(false);
  });

  it("flags a homeassistant.service node id", () => {
    expect(
      hasLegacyAutomationSpellings(
        "esphome:\n  on_boot:\n    then:\n      - homeassistant.service:\n          action: light.on\n"
      )
    ).toBe(true);
  });

  it("flags a legacy service field inside homeassistant.action", () => {
    expect(
      hasLegacyAutomationSpellings(
        "script:\n  - id: s\n    then:\n      - homeassistant.action:\n          service: light.on\n"
      )
    ).toBe(true);
  });

  it("flags a legacy field in a flow-style body", () => {
    expect(
      hasLegacyAutomationSpellings(
        "esphome:\n  on_boot:\n    then:\n      - homeassistant.action: {service: light.on}\n"
      )
    ).toBe(true);
  });

  it("ignores a deeper service key inside the node body", () => {
    expect(
      hasLegacyAutomationSpellings(
        "script:\n  - id: s\n    then:\n      - homeassistant.action:\n          action: notify\n          data:\n            service: decoy\n"
      )
    ).toBe(false);
  });

  it("ignores a flow-nested payload decoy", () => {
    expect(
      hasLegacyAutomationSpellings(
        "esphome:\n  on_boot:\n    then:\n      - homeassistant.action: {action: notify, data: {service: decoy}}\n"
      )
    ).toBe(false);
  });

  it("flags a flow legacy field beside a nested canonical decoy", () => {
    expect(
      hasLegacyAutomationSpellings(
        "esphome:\n  on_boot:\n    then:\n      - homeassistant.action: {data: {action: decoy}, service: light.on}\n"
      )
    ).toBe(true);
  });

  it("reads past comment lines in the node body", () => {
    expect(
      hasLegacyAutomationSpellings(
        "esphome:\n  on_boot:\n    then:\n      - homeassistant.action:\n        # call the light service\n          service: light.on\n"
      )
    ).toBe(true);
  });

  it("ignores a collision the canonicalizer would skip", () => {
    expect(
      hasLegacyAutomationSpellings(
        "esphome:\n  on_boot:\n    then:\n      - homeassistant.action:\n          action: a\n          service: b\n"
      )
    ).toBe(false);
  });

  it("ignores anchors inside block scalars", () => {
    expect(
      hasLegacyAutomationSpellings(
        "esphome:\n  on_boot:\n    then:\n      - lambda: |-\n          homeassistant.service: not_yaml\n"
      )
    ).toBe(false);
  });

  it("ignores unrelated service keys and empty buffers", () => {
    expect(hasLegacyAutomationSpellings("")).toBe(false);
    expect(hasLegacyAutomationSpellings("logger:\n  level: DEBUG\n")).toBe(false);
    expect(
      hasLegacyAutomationSpellings("web_server:\n  # service: comment decoy\n")
    ).toBe(false);
  });
});
