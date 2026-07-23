/**
 * Pins the taken-hostname set: device names plus filename stems, memoized
 * per device-list reference.
 */
import { describe, expect, it } from "vitest";

import { takenHostnameSet } from "../../src/util/taken-hostnames.js";

describe("takenHostnameSet", () => {
  it("collects device names and filename stems", () => {
    const set = takenHostnameSet([
      { name: "kitchen-plug", configuration: "kitchen-plug.yaml" },
      { name: "hall-light", configuration: "hall-light (1).yml" },
    ]);
    expect(set.has("kitchen-plug")).toBe(true);
    expect(set.has("hall-light")).toBe(true);
    expect(set.has("hall-light (1)")).toBe(true);
    expect(set.has("other")).toBe(false);
  });

  it("memoizes per array reference", () => {
    const devices = [{ name: "a", configuration: "a.yaml" }];
    expect(takenHostnameSet(devices)).toBe(takenHostnameSet(devices));
    expect(takenHostnameSet([...devices])).not.toBe(takenHostnameSet(devices));
  });
});
