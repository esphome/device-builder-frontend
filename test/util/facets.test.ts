/**
 * Pins computeUpdateFacet: per-bucket counts, empty-fleet → [], and
 * matched buckets surface (so the pill hides / drops an unmatched
 * bucket when the fleet is current) — except a currently-selected
 * bucket stays at count 0 so a URL-hydrated filter remains clearable.
 */
import { describe, expect, it } from "vitest";

import { identityLocalize } from "../_dom.js";
import { makeConfiguredDevice } from "../_make-configured-device.js";
import { DeviceState } from "../../src/api/types/devices.js";
import type { LocalizeFunc } from "../../src/common/localize.js";
import {
  computeStateFacet,
  computeUpdateFacet,
  normalizeUpdateBuckets,
} from "../../src/util/facets.js";

// computeUpdateFacet reads update_available / has_pending_changes, gated
// through showUpdateAvailable / showPendingChanges. The shared fixture
// defaults to a trusted identity, so update/modified buckets surface.
// These fixtures are no-api (api_enabled defaults false), so the gate
// reduces to deployed_identity_live — override that to go dark; a case
// that also sets api_enabled: true must override active_source too.
const device = makeConfiguredDevice;

// Echo the key so assertions key off the i18n id, not display copy.
const localize = identityLocalize as unknown as LocalizeFunc;

describe("computeStateFacet", () => {
  it("counts a flagged non-online device as untracked, not offline", () => {
    const options = computeStateFacet(
      [
        device({
          name_add_mac_suffix: true,
          runtime_state: { state: DeviceState.OFFLINE },
        }),
        device({ runtime_state: { state: DeviceState.OFFLINE } }),
      ],
      identityLocalize
    );
    const countById = Object.fromEntries(options.map((o) => [o.id, o.count]));
    expect(countById.untracked).toBe(1);
    expect(countById[DeviceState.OFFLINE]).toBe(1);
  });
});

describe("normalizeUpdateBuckets", () => {
  it("keeps known buckets in canonical order, deduped, dropping unknowns", () => {
    expect(normalizeUpdateBuckets(["modified", "update_available"])).toEqual([
      "update_available",
      "modified",
    ]);
    expect(
      normalizeUpdateBuckets(["update_available", "bogus", "update_available"])
    ).toEqual(["update_available"]);
    expect(normalizeUpdateBuckets([])).toEqual([]);
  });
});

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

  it("surfaces a selected bucket at count 0 so a URL filter stays clearable", () => {
    const opts = computeUpdateFacet([device({})], localize, ["update_available"]);
    expect(opts).toEqual([
      { id: "update_available", name: expect.any(String), count: 0 },
    ]);
  });
});
