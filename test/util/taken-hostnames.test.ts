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

  it("includes discovered-but-unadopted device names", () => {
    const set = takenHostnameSet(
      [{ name: "kitchen-plug", configuration: "kitchen-plug.yaml" }],
      [{ name: "garage-door" }]
    );
    expect(set.has("garage-door")).toBe(true);
  });

  it("memoizes per array reference and revalidates the importables", () => {
    const devices = [{ name: "a", configuration: "a.yaml" }];
    const importables = [{ name: "b" }];
    expect(takenHostnameSet(devices, importables)).toBe(
      takenHostnameSet(devices, importables)
    );
    expect(takenHostnameSet([...devices], importables)).not.toBe(
      takenHostnameSet(devices, importables)
    );
    expect(takenHostnameSet(devices, [...importables]).has("b")).toBe(true);
    expect(takenHostnameSet(devices, [{ name: "c" }]).has("c")).toBe(true);
  });
});
