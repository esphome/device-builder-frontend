import { describe, expect, it } from "vitest";
import { findMissingDependencies } from "../../../src/components/device/add-component-deps.js";

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

  it("treats an empty dependency list as satisfied", () => {
    expect(findMissingDependencies([], "")).toEqual([]);
  });

  it("honours a precomputed presentComponents set over the yaml", () => {
    // Caller passes its already-parsed top-level set; the empty yaml
    // would otherwise report ld2410 missing.
    expect(findMissingDependencies(["ld2410"], "", new Set(["ld2410"]))).toEqual([]);
  });
});
