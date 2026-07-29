/**
 * normalizeMaybeValues expands esphome's maybe_simple_value shorthand
 * against ConfigEntry.maybe_key at section load (#2397): a bare scalar
 * at a NESTED entry becomes the keyed mapping, and with multi_value a
 * non-list value becomes a one-item list. Everything else must pass
 * through identity-equal.
 */
import { describe, expect, it } from "vitest";

import { ConfigEntryType } from "../../src/api/types/config-entries.js";
import { makeConfigEntry } from "../../src/util/config-entry-defaults.js";
import { normalizeMaybeValues } from "../../src/util/maybe-values.js";
import { YamlRawValue } from "../../src/util/yaml-serialize.js";

const microphoneEntry = (overrides: Record<string, unknown> = {}) =>
  makeConfigEntry({
    key: "microphone",
    type: ConfigEntryType.NESTED,
    multi_value: true,
    maybe_key: "microphone",
    config_entries: [
      makeConfigEntry({ key: "microphone", type: ConfigEntryType.ID }),
      makeConfigEntry({ key: "gain_factor", type: ConfigEntryType.INTEGER }),
    ],
    ...overrides,
  });

describe("normalizeMaybeValues", () => {
  it("expands a bare scalar at a multi_value maybe entry into a one-item list", () => {
    const out = normalizeMaybeValues({ microphone: "onju_microphone" }, [
      microphoneEntry(),
    ]);
    expect(out.microphone).toEqual([{ microphone: "onju_microphone" }]);
  });

  it("expands bare scalars inside an existing list", () => {
    const out = normalizeMaybeValues({ microphone: ["mic_a", { microphone: "mic_b" }] }, [
      microphoneEntry(),
    ]);
    expect(out.microphone).toEqual([{ microphone: "mic_a" }, { microphone: "mic_b" }]);
  });

  it("wraps a bare mapping at a multi_value maybe entry", () => {
    const out = normalizeMaybeValues(
      { microphone: { microphone: "mic_a", gain_factor: 2 } },
      [microphoneEntry()]
    );
    expect(out.microphone).toEqual([{ microphone: "mic_a", gain_factor: 2 }]);
  });

  it("expands a bare scalar at a single nested maybe entry into the keyed mapping", () => {
    const entry = microphoneEntry({ multi_value: false });
    const out = normalizeMaybeValues({ microphone: "mww_microphone" }, [entry]);
    expect(out.microphone).toEqual({ microphone: "mww_microphone" });
  });

  it("expands a shorthand on a nested descendant (the sprinkler valves shape)", () => {
    const valves = makeConfigEntry({
      key: "valves",
      type: ConfigEntryType.NESTED,
      multi_value: true,
      config_entries: [
        makeConfigEntry({
          key: "valve_switch",
          type: ConfigEntryType.NESTED,
          maybe_key: "name",
          config_entries: [
            makeConfigEntry({ key: "name", type: ConfigEntryType.STRING }),
          ],
        }),
      ],
    });
    const out = normalizeMaybeValues({ valves: [{ valve_switch: "Front Lawn" }] }, [
      valves,
    ]);
    expect(out.valves).toEqual([{ valve_switch: { name: "Front Lawn" } }]);
  });

  it("returns the input identity-equal when nothing needs expanding", () => {
    const canonical = { microphone: [{ microphone: "mic_a" }], name: "va" };
    expect(normalizeMaybeValues(canonical, [microphoneEntry()])).toBe(canonical);
  });

  it("leaves a scalar at a multi_value entry without maybe_key untouched", () => {
    const values = { microphone: "onju_microphone" };
    const entry = microphoneEntry({ maybe_key: null });
    expect(normalizeMaybeValues(values, [entry])).toBe(values);
  });

  it("passes YamlRawValue through untouched", () => {
    // The renderers' raw-block bail-outs are literal instanceof checks;
    // wrapping the instance would stop them firing and clobber the
    // user's preserved YAML on the next save.
    const values = { microphone: new YamlRawValue(["    - dotted.key: 1"]) };
    expect(normalizeMaybeValues(values, [microphoneEntry()])).toBe(values);
  });

  it("passes a YamlRawValue inside a list through untouched", () => {
    const values = { microphone: [new YamlRawValue(["    - dotted.key: 1"])] };
    expect(normalizeMaybeValues(values, [microphoneEntry()])).toBe(values);
  });

  it("preserves a null prototype on the cloned container", () => {
    const values = Object.create(null) as Record<string, unknown>;
    values.microphone = "onju_microphone";
    const out = normalizeMaybeValues(values, [microphoneEntry()]);
    expect(out).not.toBe(values);
    expect(Object.getPrototypeOf(out)).toBeNull();
    expect(out.microphone).toEqual([{ microphone: "onju_microphone" }]);
  });

  it("does not mutate the input container or list", () => {
    const list = ["mic_a"];
    const values = { microphone: list };
    const out = normalizeMaybeValues(values, [microphoneEntry()]);
    expect(values.microphone).toBe(list);
    expect(list).toEqual(["mic_a"]);
    expect(out.microphone).toEqual([{ microphone: "mic_a" }]);
  });
});
