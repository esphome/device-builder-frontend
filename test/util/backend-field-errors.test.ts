import { beforeEach, describe, expect, it } from "vitest";
import {
  backendErrorCounts,
  backendErrorsForInstance,
  formRelativePath,
  instanceKey,
  resolveBackendErrors,
  type BackendFieldError,
} from "../../src/util/backend-field-errors.js";
import { _clearYamlSectionsMemo } from "../../src/util/yaml-sections.js";

beforeEach(() => {
  _clearYamlSectionsMemo();
});

const YAML = `esphome:
  name: test

wifi:
  ssid: !secret wifi_ssid
  password: !secret wifi_password

sensor:
  - platform: dht
    pin: GPIO4
    update_interval: 60s
  - platform: dht
    pin: GPIO5
    update_interval: bogus
`;

describe("formRelativePath", () => {
  it("drops the top-level section key", () => {
    expect(formRelativePath(["wifi", "ssid"])).toEqual(["ssid"]);
    expect(formRelativePath(["sensor", "update_interval"])).toEqual(["update_interval"]);
  });

  it("keeps the section key for LIST_SECTIONS with a child segment", () => {
    expect(formRelativePath(["globals", "initial_value"])).toEqual([
      "globals",
      "initial_value",
    ]);
  });

  it("reduces a bare section header to an empty path", () => {
    expect(formRelativePath(["wifi"])).toEqual([]);
    expect(formRelativePath(["globals"])).toEqual([]);
    expect(formRelativePath([])).toEqual([]);
  });

  it("keeps nested list indices when the path ends in a key", () => {
    expect(formRelativePath(["esphome", "areas", 0, "id"])).toEqual(["areas", 0, "id"]);
  });

  it("reduces a path ending in a list index to an empty path", () => {
    expect(formRelativePath(["sensor", 1])).toEqual([]);
    expect(formRelativePath(["esphome", "areas", 0])).toEqual([]);
    expect(formRelativePath(["globals", 0])).toEqual([]);
  });
});

describe("resolveBackendErrors", () => {
  it("pins an error on the section instance owning its line", () => {
    const errors = resolveBackendErrors(YAML, [
      { message: "bad interval", line: 14, keyPath: ["sensor", "update_interval"] },
    ]);
    expect(errors).toEqual([
      {
        sectionKey: "sensor.dht",
        fromLine: 12,
        relPath: "update_interval",
        message: "bad interval",
      },
    ]);
  });

  it("distinguishes duplicate platform instances by line", () => {
    const first = resolveBackendErrors(YAML, [
      { message: "x", line: 11, keyPath: ["sensor", "update_interval"] },
    ]);
    const second = resolveBackendErrors(YAML, [
      { message: "x", line: 14, keyPath: ["sensor", "update_interval"] },
    ]);
    expect(first[0].fromLine).toBe(9);
    expect(second[0].fromLine).toBe(12);
  });

  it("keeps a section-level error with an empty relPath", () => {
    const errors = resolveBackendErrors(YAML, [
      { message: "component not found", line: 4, keyPath: ["wifi"] },
    ]);
    expect(errors).toEqual([
      { sectionKey: "wifi", fromLine: 4, relPath: "", message: "component not found" },
    ]);
  });

  it("falls back to the key path when the line misses every section", () => {
    const errors = resolveBackendErrors(YAML, [
      { message: "x", line: 999, keyPath: ["wifi", "ssid"] },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].sectionKey).toBe("wifi");
  });

  it("drops an error that resolves to no section at all", () => {
    expect(
      resolveBackendErrors(YAML, [{ message: "x", line: 999, keyPath: [] }])
    ).toEqual([]);
  });

  it("keeps nested list indices in the field path", () => {
    const yaml = `esphome:
  name: test
  areas:
    - name: Kitchen
      id: $$
`;
    const errors = resolveBackendErrors(yaml, [
      { message: "bad id", line: 5, keyPath: ["esphome", "areas", 0, "id"] },
    ]);
    expect(errors).toEqual([
      { sectionKey: "esphome", fromLine: 1, relPath: "areas.0.id", message: "bad id" },
    ]);
  });

  it("strips the redundant domain-list index for expanded platform instances", () => {
    const errors = resolveBackendErrors(YAML, [
      { message: "x", line: 14, keyPath: ["sensor", 1, "update_interval"] },
    ]);
    expect(errors).toEqual([
      {
        sectionKey: "sensor.dht",
        fromLine: 12,
        relPath: "update_interval",
        message: "x",
      },
    ]);
  });

  it("dedupes to the visible set: one per field path, one per section message", () => {
    const errors = resolveBackendErrors(YAML, [
      { message: "first", line: 14, keyPath: ["sensor", "update_interval"] },
      { message: "second", line: 14, keyPath: ["sensor", "update_interval"] },
      { message: "component broken", line: 4, keyPath: ["wifi"] },
      { message: "component broken", line: 5, keyPath: ["wifi"] },
      { message: "another problem", line: 4, keyPath: ["wifi"] },
    ]);
    expect(errors.map((e) => `${e.sectionKey}:${e.relPath}:${e.message}`)).toEqual([
      "sensor.dht:update_interval:first",
      "wifi::component broken",
      "wifi::another problem",
    ]);
  });
});

describe("backendErrorCounts", () => {
  it("aggregates per section instance", () => {
    const errors: BackendFieldError[] = [
      {
        sectionKey: "sensor.dht",
        fromLine: 16,
        relPath: "update_interval",
        message: "a",
      },
      { sectionKey: "sensor.dht", fromLine: 16, relPath: "pin", message: "b" },
      { sectionKey: "sensor.dht", fromLine: 13, relPath: "pin", message: "c" },
      { sectionKey: "wifi", fromLine: 4, relPath: "", message: "d" },
    ];
    const counts = backendErrorCounts(errors);
    expect(counts.get(instanceKey("sensor.dht", 16))).toBe(2);
    expect(counts.get(instanceKey("sensor.dht", 13))).toBe(1);
    expect(counts.get(instanceKey("wifi", 4))).toBe(1);
  });
});

describe("backendErrorsForInstance", () => {
  const errors: BackendFieldError[] = [
    { sectionKey: "sensor.dht", fromLine: 16, relPath: "update_interval", message: "a" },
    { sectionKey: "sensor.dht", fromLine: 13, relPath: "pin", message: "b" },
    { sectionKey: "wifi", fromLine: 4, relPath: "", message: "section only" },
    { sectionKey: "wifi", fromLine: 4, relPath: "ssid", message: "field error" },
  ];

  it("partitions the selected instance's errors for the section editor", () => {
    const { fields, fieldMessages, sectionMessages } = backendErrorsForInstance(
      errors,
      "wifi",
      4
    );
    expect([...fields.keys()]).toEqual(["ssid"]);
    expect(fields.get("ssid")).toEqual({
      key: "ssid",
      code: "validation.backend",
      params: { message: "field error" },
    });
    expect(fieldMessages).toEqual(["field error"]);
    expect(sectionMessages).toEqual(["section only"]);
  });

  it("excludes other instances of the same section key", () => {
    expect([...backendErrorsForInstance(errors, "sensor.dht", 13).fields.keys()]).toEqual(
      ["pin"]
    );
  });

  it("matches any instance when fromLine is undefined", () => {
    expect(
      [...backendErrorsForInstance(errors, "sensor.dht", undefined).fields.keys()].sort()
    ).toEqual(["pin", "update_interval"]);
  });

  it("returns the shared empty value for no selection or no match", () => {
    expect(backendErrorsForInstance(errors, null, undefined).fields.size).toBe(0);
    const miss = backendErrorsForInstance(errors, "wifi", 99);
    expect(miss.fields.size).toBe(0);
    expect(miss.fieldMessages).toEqual([]);
    expect(miss.sectionMessages).toEqual([]);
  });
});
