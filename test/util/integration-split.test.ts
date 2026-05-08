/**
 * Tests for ``splitIntegrations`` — the helper that powers the
 * device-drawer's "Loaded Integrations" direct/auto-loaded split
 * (issue #422).
 *
 * The function is the entire correctness boundary for the
 * drawer's primary vs collapsed sections; bug here means the
 * wrong chips land in the wrong bucket. Pin the four scenarios
 * the drawer's render path actually hits:
 *
 *  1. Real device with both direct + auto-loaded entries — the
 *     normal path, validates ordering + bucket assignment.
 *  2. Empty ``directly_referenced_integrations`` (graceful
 *     degrade — backend couldn't resolve the YAML) — everything
 *     lands in ``direct`` with ``splittable: false`` so the
 *     drawer falls back to the pre-#422 flat-list rendering.
 *  3. Empty ``loaded_integrations`` — empty buckets either way.
 *  4. ``null`` / ``undefined`` inputs — defensive against the
 *     wire shape changing.
 */

import { describe, expect, it } from "vitest";
import { splitIntegrations } from "../../src/util/integration-split.js";

describe("splitIntegrations", () => {
  it("buckets direct + auto-loaded entries from a real device", () => {
    // Mirrors the issue #422 reporter's ``acfloatmonitor32`` case:
    // a config with ``api``, ``ethernet``, ``binary_sensor`` /
    // ``- platform: gpio``, etc. The auto-loaded chain pulls in
    // ``md5``, ``mdns``, ``network``, ``preferences``, ``socket``,
    // ``watchdog`` (and more) which the drawer's collapsible
    // tucks away.
    const loaded = [
      "api",
      "binary_sensor",
      "esp32",
      "esphome",
      "ethernet",
      "gpio",
      "md5",
      "mdns",
      "network",
      "ota",
      "preferences",
      "socket",
      "watchdog",
    ];
    const direct = [
      "api",
      "binary_sensor",
      "esp32",
      "esphome",
      "ethernet",
      "gpio",
      "ota",
    ];
    const result = splitIntegrations(loaded, direct);
    expect(result.direct).toEqual([
      "api",
      "binary_sensor",
      "esp32",
      "esphome",
      "ethernet",
      "gpio",
      "ota",
    ]);
    expect(result.indirect).toEqual([
      "md5",
      "mdns",
      "network",
      "preferences",
      "socket",
      "watchdog",
    ]);
    expect(result.splittable).toBe(true);
  });

  it("preserves the input ordering within each bucket", () => {
    // Backend already sorts ``loaded_integrations`` alphabetically;
    // both buckets need to inherit that ordering (the drawer
    // renders them as flat chip rows, not re-sorted). A naive
    // ``filter()`` over a Set could shuffle the auto-loaded
    // bucket, which is what this case pins.
    const loaded = ["zlast", "alpha", "mid", "beta", "auto1", "auto2"];
    const direct = ["alpha", "beta"];
    const { direct: out, indirect } = splitIntegrations(loaded, direct);
    expect(out).toEqual(["alpha", "beta"]);
    // ``zlast`` and ``mid`` weren't in ``direct`` — they land in
    // indirect alongside ``auto1`` / ``auto2``, in the same
    // order they appeared in ``loaded``.
    expect(indirect).toEqual(["zlast", "mid", "auto1", "auto2"]);
  });

  it("falls back to direct=loaded when the backend didn't compute the split", () => {
    // Empty ``directly_referenced_integrations`` is the
    // graceful-degrade signal — backend's resolved-YAML parse
    // failed (mid-edit drafts, missing secrets) so it doesn't
    // know which entries are direct. The drawer must render the
    // flat ``loaded_integrations`` list under its existing
    // header, NOT bucket everything as auto-loaded — that would
    // hide every chip behind the collapsible.
    const loaded = ["api", "wifi", "logger"];
    const result = splitIntegrations(loaded, []);
    expect(result.direct).toEqual(["api", "wifi", "logger"]);
    expect(result.indirect).toEqual([]);
    expect(result.splittable).toBe(false);
  });

  it("returns empty buckets for empty loaded_integrations", () => {
    // Brand-new device that hasn't compiled — the drawer's
    // section guard hides the whole row in that case, but the
    // helper still has to return a valid split.
    const result = splitIntegrations([], ["api"]);
    expect(result.direct).toEqual([]);
    expect(result.indirect).toEqual([]);
    // ``directly_referenced_integrations`` was non-empty so the
    // backend DID compute a split — there just wasn't anything
    // loaded to bucket. ``splittable: true`` is harmless either
    // way (the drawer hides the section anyway).
    expect(result.splittable).toBe(true);
  });

  it("treats null / undefined as empty", () => {
    // Defensive — older device records on the wire (or a stale
    // serialiser path) might omit either field. Coerce to ``[]``
    // so the helper never throws on access.
    expect(splitIntegrations(null, null)).toEqual({
      direct: [],
      indirect: [],
      splittable: false,
    });
    expect(splitIntegrations(undefined, undefined)).toEqual({
      direct: [],
      indirect: [],
      splittable: false,
    });
    expect(splitIntegrations(["api"], null)).toEqual({
      direct: ["api"],
      indirect: [],
      splittable: false,
    });
  });

  it("ignores entries in directly_referenced that aren't in loaded", () => {
    // The two lists come from different backend sources
    // (StorageJSON for ``loaded``, resolved YAML for ``direct``)
    // — they normally agree, but a stale StorageJSON could
    // theoretically report ``direct`` entries the firmware
    // doesn't actually have loaded. The split should silently
    // ignore those rather than hallucinate them as chips.
    const loaded = ["api", "wifi"];
    const direct = ["api", "wifi", "fictional_component"];
    const result = splitIntegrations(loaded, direct);
    expect(result.direct).toEqual(["api", "wifi"]);
    expect(result.indirect).toEqual([]);
    expect(result.splittable).toBe(true);
  });
});
