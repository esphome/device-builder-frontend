/**
 * @vitest-environment happy-dom
 *
 * Pins computeUpdateFacet: per-bucket counts, empty-fleet → [], and
 * only-non-zero buckets surface (so the dashboard hides the pill /
 * drops a bucket nothing matches).
 */
import { describe, expect, it } from "vitest";

import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import { computeUpdateFacet } from "../../src/util/facets.js";

// computeUpdateFacet only reads update_available / has_pending_changes.
function device(over: Partial<ConfiguredDevice>): ConfiguredDevice {
  return over as ConfiguredDevice;
}

// Echo the key so assertions key off the i18n id, not display copy.
const localize = ((key: string) => key) as never;

describe("computeUpdateFacet", () => {
  it("returns [] for an up-to-date fleet", () => {
    expect(computeUpdateFacet([device({}), device({})], localize)).toEqual([]);
  });

  it("counts update_available and modified into separate buckets", () => {
    const devices = [
      device({ update_available: true }),
      device({ update_available: true, has_pending_changes: true }),
      device({ has_pending_changes: true }),
    ];
    const byId = new Map(
      computeUpdateFacet(devices, localize).map((o) => [o.id, o.count])
    );
    expect(byId.get("update_available")).toBe(2);
    expect(byId.get("modified")).toBe(2);
  });

  it("drops a bucket no device matches", () => {
    const ids = computeUpdateFacet([device({ update_available: true })], localize).map(
      (o) => o.id
    );
    expect(ids).toEqual(["update_available"]);
  });
});
