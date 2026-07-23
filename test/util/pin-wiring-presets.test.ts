import { describe, expect, it } from "vitest";
import type { BoardPin } from "../../src/api/types/boards.js";
import { PinMode } from "../../src/api/types/config-entries.js";
import {
  applyPresetToPin,
  modeFlagsOf,
  presetsForPinMode,
  presetUnavailableReason,
  wiringStateOf,
  wiringTechSummary,
} from "../../src/util/pin-wiring-presets.js";

const inputPresets = presetsForPinMode(PinMode.INPUT);
const outputPresets = presetsForPinMode(PinMode.OUTPUT);
const byId = (id: string) =>
  [...inputPresets, ...outputPresets].find((p) => p.id === id)!;

const presetIdOf = (state: ReturnType<typeof wiringStateOf>) =>
  state.kind === "preset" ? state.preset.id : state.kind;

describe("presetsForPinMode", () => {
  it("keys the preset set on the field's declared direction", () => {
    expect(inputPresets.map((p) => p.id)).toEqual([
      "ground_switch",
      "vcc_switch",
      "driven_signal",
    ]);
    expect(outputPresets.map((p) => p.id)).toEqual([
      "output_standard",
      "output_active_low",
      "output_open_drain",
    ]);
    expect(presetsForPinMode(PinMode.INPUT_OUTPUT)).toEqual([]);
    expect(presetsForPinMode(null)).toEqual([]);
    expect(presetsForPinMode(undefined)).toEqual([]);
  });
});

describe("modeFlagsOf", () => {
  it("reads object flags, tolerating YAML boolean spellings", () => {
    expect(modeFlagsOf({ input: true, pullup: "on", output: false })).toEqual({
      input: true,
      pullup: true,
    });
  });

  it("expands known scalar shorthands and rejects unknown ones", () => {
    expect(modeFlagsOf("INPUT_PULLUP")).toEqual({ input: true, pullup: true });
    expect(modeFlagsOf("BOGUS")).toBeNull();
  });

  it("refuses a flag holding a substitution instead of dropping it", () => {
    // Silently dropping ``pullup: ${use_pullup}`` would misclassify the
    // pin and the next guided edit would delete the substitution line.
    expect(modeFlagsOf({ input: true, pullup: "${use_pullup}" })).toBeNull();
    expect(
      wiringStateOf(inputPresets, { input: true, pullup: "${use_pullup}" }, undefined)
        .kind
    ).toBe("custom");
  });

  it("treats an absent mode as no flags", () => {
    expect(modeFlagsOf(undefined)).toEqual({});
    expect(modeFlagsOf(null)).toEqual({});
  });
});

describe("wiringStateOf", () => {
  it("classifies an untouched pin as default without a direction", () => {
    expect(wiringStateOf(inputPresets, undefined, undefined).kind).toBe("default");
  });

  it("treats an explicit inverted false with no flags as untouched", () => {
    // The boolean toggle writes false when switched back off; that must
    // not read as Custom (or auto-seed the section open).
    expect(wiringStateOf(outputPresets, undefined, false, PinMode.OUTPUT)).toMatchObject({
      kind: "preset",
      implicit: true,
    });
    expect(wiringStateOf(outputPresets, undefined, false).kind).toBe("default");
  });

  it("maps an untouched pin to the direction's implied preset", () => {
    const output = wiringStateOf(outputPresets, undefined, undefined, PinMode.OUTPUT);
    expect(output).toMatchObject({
      kind: "preset",
      implicit: true,
      preset: { id: "output_standard" },
    });
    const input = wiringStateOf(inputPresets, undefined, undefined, PinMode.INPUT);
    expect(input).toMatchObject({
      kind: "preset",
      implicit: true,
      preset: { id: "driven_signal" },
    });
  });

  it("matches each input preset by exact flag set, inverted-agnostic", () => {
    expect(
      presetIdOf(wiringStateOf(inputPresets, { input: true, pullup: true }, true))
    ).toBe("ground_switch");
    expect(
      presetIdOf(wiringStateOf(inputPresets, { input: true, pullup: true }, undefined))
    ).toBe("ground_switch");
    expect(
      presetIdOf(wiringStateOf(inputPresets, { input: true, pulldown: true }, false))
    ).toBe("vcc_switch");
    expect(presetIdOf(wiringStateOf(inputPresets, { input: true }, undefined))).toBe(
      "driven_signal"
    );
  });

  it("matches scalar shorthands through the same expansion", () => {
    expect(presetIdOf(wiringStateOf(inputPresets, "INPUT_PULLUP", true))).toBe(
      "ground_switch"
    );
    expect(presetIdOf(wiringStateOf(outputPresets, "OUTPUT", undefined))).toBe(
      "output_standard"
    );
  });

  it("splits the shared output flag set on inverted", () => {
    expect(presetIdOf(wiringStateOf(outputPresets, { output: true }, undefined))).toBe(
      "output_standard"
    );
    expect(presetIdOf(wiringStateOf(outputPresets, { output: true }, true))).toBe(
      "output_active_low"
    );
    expect(
      presetIdOf(
        wiringStateOf(outputPresets, { output: true, open_drain: true }, undefined)
      )
    ).toBe("output_open_drain");
  });

  it("falls to custom for anything no preset names", () => {
    // Both pulls set — a combination the guided UI can't produce.
    expect(
      wiringStateOf(inputPresets, { input: true, pullup: true, pulldown: true }, false)
        .kind
    ).toBe("custom");
    expect(wiringStateOf(inputPresets, "BOGUS", undefined).kind).toBe("custom");
    // Inverted set with no readable boolean (a substitution) can't be
    // classified as a preset.
    expect(
      wiringStateOf(inputPresets, { input: true, pullup: true }, "${inv}").kind
    ).toBe("custom");
    // Inverted alone, no mode.
    expect(wiringStateOf(inputPresets, undefined, true).kind).toBe("custom");
  });
});

describe("applyPresetToPin", () => {
  it("promotes a scalar pin and writes flags plus inverted", () => {
    expect(applyPresetToPin(byId("ground_switch"), "GPIO4")).toEqual({
      number: "GPIO4",
      mode: { input: true, pullup: true },
      inverted: true,
    });
  });

  it("preserves unrelated long-form keys and clears inverted when asked", () => {
    const current = {
      number: "GPIO5",
      allow_other_uses: true,
      mode: { output: true },
      inverted: true,
    };
    expect(applyPresetToPin(byId("vcc_switch"), current)).toEqual({
      number: "GPIO5",
      allow_other_uses: true,
      mode: { input: true, pulldown: true },
    });
  });

  it("leaves inverted untouched when the preset doesn't care", () => {
    const current = { number: "GPIO5", inverted: true };
    expect(applyPresetToPin(byId("driven_signal"), current)).toEqual({
      number: "GPIO5",
      inverted: true,
      mode: { input: true },
    });
  });

  it("writes a bare mode block for a pin with no value yet", () => {
    expect(applyPresetToPin(byId("output_standard"), undefined)).toEqual({
      mode: { output: true },
    });
  });
});

describe("wiringTechSummary", () => {
  it("joins the set flags and appends inverted", () => {
    expect(wiringTechSummary({ input: true, pullup: true }, true)).toBe(
      "input + pullup · inverted"
    );
    expect(wiringTechSummary({ output: true }, false)).toBe("output");
    expect(wiringTechSummary({}, true)).toBe("inverted");
    expect(wiringTechSummary({}, false)).toBe("");
  });
});

describe("presetUnavailableReason", () => {
  const inputOnlyPin: BoardPin = {
    gpio: 34,
    label: "GPIO34",
    features: ["input", "input_only"],
    available: true,
    occupied_by: null,
    notes: null,
  };

  it("rules out pull and output presets on an input-only pin", () => {
    expect(presetUnavailableReason(byId("ground_switch"), inputOnlyPin)).toBe(
      "input_only"
    );
    expect(presetUnavailableReason(byId("vcc_switch"), inputOnlyPin)).toBe("input_only");
    expect(presetUnavailableReason(byId("output_standard"), inputOnlyPin)).toBe(
      "input_only"
    );
    expect(presetUnavailableReason(byId("driven_signal"), inputOnlyPin)).toBeNull();
  });

  it("rules nothing out without board pin knowledge", () => {
    expect(presetUnavailableReason(byId("ground_switch"), null)).toBeNull();
  });
});
