/**
 * Walk ``renderPinField``'s ``TemplateResult`` and assert which
 * ``<wa-option>`` is marked ``?selected=true`` for the YAML
 * shapes the renderer is supposed to handle:
 *
 *   - long-form pin block (``{ number: 'GPIO33', ... }``)
 *   - bare integer (``{ number: 33 }``)
 *   - unparseable shape (no ``number`` key) — defensively
 *     selects nothing, so a future ``parsePinGpio`` regression
 *     can't quietly default to GPIO0
 *   - null-prototype map (mid-edit YAML from js-yaml) — must
 *     not crash on the ``String()`` fallback
 *
 * These are template-shape assertions: which option carries the
 * ``?selected`` boolean attribute, which ``value`` attribute it
 * has, and which ``.label`` property was bound to it. We don't
 * assert on the closed-state ``displayLabel`` here — wa-select's
 * runtime needs a real DOM with form-associated internals, and
 * happy-dom doesn't implement ``ElementInternals.validity``.
 *
 * Walker / ctx factory / binding extractor live in
 * ``test/_lit-template-walker.ts`` + ``./_renderer-fixtures.ts``
 * so future renderer tests reuse them; bindings are looked up by
 * name (``b.value``, ``b["?selected"]``, ``b[".label"]``) so
 * attribute order in the renderer source isn't load-bearing.
 */
import { describe, expect, it } from "vitest";
import {
  ConfigEntryType,
  PinFeature,
  PinMode,
} from "../../../src/api/types/config-entries.js";
import { renderPinField } from "../../../src/components/device/config-entry-pin-renderer.js";
import { findTemplatesByAnchor } from "../../_lit-template-walker.js";
import {
  findElementBindings,
  makeBoardPin,
  makeEntry,
  makeRenderCtx,
  makeTestBoard,
} from "./_renderer-fixtures.js";

const pinEntry = () =>
  makeEntry(ConfigEntryType.PIN, {
    key: "pin",
    label: "Pin",
    required: true,
    // Empty pin_features list so every fixture pin qualifies — the
    // renderer's ``required.every(...)`` filter over an empty
    // array is vacuously true.
    pin_features: [],
  });

const flag = (key: string, label: string) =>
  makeEntry(ConfigEntryType.BOOLEAN, { key, label, advanced: true });

const modeChild = () =>
  makeEntry(ConfigEntryType.NESTED, {
    key: "mode",
    label: "Mode",
    advanced: true,
    config_entries: [
      flag("input", "Input"),
      flag("output", "Output"),
      flag("pullup", "Pullup"),
    ],
  });

/** Pin entry carrying the long-form ``mode`` flag group, with the
 *  Advanced disclosure and the Mode group pre-opened so the flag
 *  switches render. */
const longFormPinEntry = () =>
  makeEntry(ConfigEntryType.PIN, {
    key: "pin",
    label: "Pin",
    required: true,
    pin_features: [],
    config_entries: [modeChild()],
  });

const openModeCtx = (pin: unknown, pinRegistryModes?: Record<string, string[]>) =>
  makeRenderCtx(
    { pin },
    {
      overrides: {
        nestedOpenSections: new Set(["pin:pin-advanced", "pin.mode"]),
        ...(pinRegistryModes ? { pinRegistryModes } : {}),
      },
    }
  );

const switchByLabel = (result: unknown, label: string) =>
  findElementBindings(result, "wa-switch").find((b) => b["aria-label"] === label);

describe("renderPinField — long-form pin block selection", () => {
  it("marks the GPIO33 option ?selected=true when the YAML uses { number: 'GPIO33', ... }", () => {
    const ctx = makeRenderCtx({
      pin: { number: "GPIO33", mode: "INPUT_PULLUP", inverted: false },
    });
    const result = renderPinField(pinEntry(), ["pin"], ctx);

    const options = findElementBindings(result, "wa-option");
    expect(options.length, "expected wa-options to be rendered").toBeGreaterThan(0);

    const selected = options.filter((o) => o["?selected"] === true);
    expect(
      selected.length,
      `exactly one option should be selected; got ${selected.length} (${selected
        .map((s) => String(s.value))
        .join(", ")})`
    ).toBe(1);
    expect(selected[0].value, "selected option value").toBe("GPIO33");
    expect(selected[0][".label"], "selected option label").toBe("GPIO33");
  });

  it("marks GPIO33 selected when YAML uses bare integer { number: 33 }", () => {
    const ctx = makeRenderCtx({ pin: { number: 33 } });
    const result = renderPinField(pinEntry(), ["pin"], ctx);

    const selected = findElementBindings(result, "wa-option").filter(
      (o) => o["?selected"] === true
    );
    expect(selected.length).toBe(1);
    expect(selected[0].value).toBe("GPIO33");
  });

  it("does NOT select any option for an unparseable long-form value", () => {
    // Defensive: if number is missing / garbage, no option should be
    // marked selected (rather than silently picking the first or
    // claiming GPIO0).
    const ctx = makeRenderCtx({ pin: { mode: "INPUT", inverted: false } });
    const result = renderPinField(pinEntry(), ["pin"], ctx);

    const selected = findElementBindings(result, "wa-option").filter(
      (o) => o["?selected"] === true
    );
    expect(selected.length).toBe(0);
  });

  it("does not throw when the pin value is a null-prototype object", () => {
    // js-yaml emits ``Object.create(null)`` maps for partial / mid-
    // edit YAML. ``String()`` on those throws "Cannot convert
    // object to primitive value", which would crash the renderer.
    // The fallback path has to recognise non-primitives and
    // return an empty selection instead.
    const partial = Object.create(null) as Record<string, unknown>;
    partial.mode = "INPUT_PULLUP";
    const ctx = makeRenderCtx({ pin: partial });

    expect(() => renderPinField(pinEntry(), ["pin"], ctx)).not.toThrow();

    const result = renderPinField(pinEntry(), ["pin"], ctx);
    const selected = findElementBindings(result, "wa-option").filter(
      (o) => o["?selected"] === true
    );
    expect(selected.length).toBe(0);
  });
});

describe("renderPinField — mode scalar shorthand expansion", () => {
  it("ticks the matching flag checkbox for a scalar shorthand (mode: OUTPUT)", () => {
    const ctx = openModeCtx({ number: 0, mode: "OUTPUT" });
    const result = renderPinField(longFormPinEntry(), ["pin"], ctx);

    expect(switchByLabel(result, "Output")?.["?checked"]).toBe(true);
    expect(switchByLabel(result, "Input")?.["?checked"]).toBe(false);
    expect(switchByLabel(result, "Pullup")?.["?checked"]).toBe(false);
  });

  it("ticks both flags of a compound shorthand (mode: INPUT_PULLUP)", () => {
    const ctx = openModeCtx({ number: "GPIO33", mode: "INPUT_PULLUP" });
    const result = renderPinField(longFormPinEntry(), ["pin"], ctx);

    expect(switchByLabel(result, "Input")?.["?checked"]).toBe(true);
    expect(switchByLabel(result, "Pullup")?.["?checked"]).toBe(true);
    expect(switchByLabel(result, "Output")?.["?checked"]).toBe(false);
  });

  it("promotes the scalar to the flag-object form when a flag is toggled", () => {
    const ctx = openModeCtx({ number: 0, mode: "OUTPUT" });
    const result = renderPinField(longFormPinEntry(), ["pin"], ctx);

    const onChange = switchByLabel(result, "Pullup")?.["@change"] as (e: unknown) => void;
    onChange({ target: { checked: true } });

    expect(ctx.emitChange).toHaveBeenCalledWith(["pin", "mode"], {
      output: true,
      pullup: true,
    });
  });

  it("does not emit a change just from rendering (YAML scalar preserved)", () => {
    const ctx = openModeCtx({ number: 0, mode: "OUTPUT" });
    renderPinField(longFormPinEntry(), ["pin"], ctx);
    expect(ctx.emitChange).not.toHaveBeenCalled();
  });

  it("renders a read-only notice for an unknown shorthand (mode: BOGUS)", () => {
    const ctx = openModeCtx({ number: 0, mode: "BOGUS" });
    const result = renderPinField(longFormPinEntry(), ["pin"], ctx);
    // No flag switches; the value falls through to the scalar notice.
    expect(findElementBindings(result, "wa-switch")).toHaveLength(0);
  });
});

describe("renderPinField — mode flags scoped to the pin registry", () => {
  const PCA9554_MODES = { pca9554: ["input", "output"] };

  it("hides flags an external provider doesn't allow (pca9554 -> no pullup)", () => {
    const ctx = openModeCtx({ pca9554: "hub", number: 0, mode: "OUTPUT" }, PCA9554_MODES);
    const result = renderPinField(longFormPinEntry(), ["pin"], ctx);

    expect(switchByLabel(result, "Output")?.["?checked"]).toBe(true);
    expect(switchByLabel(result, "Input")).toBeDefined();
    expect(switchByLabel(result, "Pullup")).toBeUndefined();
  });

  it("keeps every flag for a native pin (no provider key in the value)", () => {
    const ctx = openModeCtx({ number: "GPIO33", mode: "OUTPUT" }, PCA9554_MODES);
    const result = renderPinField(longFormPinEntry(), ["pin"], ctx);

    expect(switchByLabel(result, "Pullup")).toBeDefined();
    expect(switchByLabel(result, "Input")).toBeDefined();
    expect(switchByLabel(result, "Output")).toBeDefined();
  });

  it("keeps every flag when the registry map is absent (graceful fallback)", () => {
    const ctx = openModeCtx({ pca9554: "hub", number: 0, mode: "OUTPUT" });
    const result = renderPinField(longFormPinEntry(), ["pin"], ctx);

    expect(switchByLabel(result, "Pullup")).toBeDefined();
  });

  it("keeps every flag for an unknown provider not in the map", () => {
    const ctx = openModeCtx(
      { some_future_expander: "hub", number: 0, mode: "OUTPUT" },
      PCA9554_MODES
    );
    const result = renderPinField(longFormPinEntry(), ["pin"], ctx);

    expect(switchByLabel(result, "Pullup")).toBeDefined();
  });

  it("keeps a disallowed flag visible when the value already sets it (legacy repair)", () => {
    // pca9554 disallows pullup, but a legacy config set INPUT_PULLUP; the
    // Pullup checkbox must stay so the user can untick it to repair the config.
    const ctx = openModeCtx(
      { pca9554: "hub", number: 0, mode: "INPUT_PULLUP" },
      PCA9554_MODES
    );
    const result = renderPinField(longFormPinEntry(), ["pin"], ctx);

    expect(switchByLabel(result, "Pullup")?.["?checked"]).toBe(true);
    expect(switchByLabel(result, "Input")?.["?checked"]).toBe(true);
    expect(switchByLabel(result, "Output")).toBeDefined();
  });

  it("keeps every flag when the provider's allowed list is empty", () => {
    // Defensive: an empty allow-list must fall back to show-all rather than
    // scope the Mode group to zero checkboxes.
    const ctx = openModeCtx({ weird: "hub", number: 0, mode: "OUTPUT" }, { weird: [] });
    const result = renderPinField(longFormPinEntry(), ["pin"], ctx);

    expect(switchByLabel(result, "Pullup")).toBeDefined();
    expect(switchByLabel(result, "Output")).toBeDefined();
  });
});

describe("renderPinField — feature/direction soft-filter (issue #1012)", () => {
  // Board: GPIO32 has ADC, GPIO25 doesn't, GPIO34 is input-only, GPIO6 is
  // board-unavailable.
  const board = () =>
    makeTestBoard({
      pins: [
        makeBoardPin(32, { features: ["input", "output", "adc"] }),
        makeBoardPin(25, { features: ["input", "output"] }),
        makeBoardPin(34, { features: ["input", "input_only"] }),
        makeBoardPin(6, { features: ["input", "output"], available: false }),
      ],
    });
  const optByValue = (result: unknown, gpio: number) =>
    findElementBindings(result, "wa-option").find((o) => o.value === `GPIO${gpio}`);

  it("shows a non-matching pin (not hidden) under Other, without a warning", () => {
    const entry = makeEntry(ConfigEntryType.PIN, {
      key: "pin",
      required: true,
      pin_features: [PinFeature.ADC],
    });
    const result = renderPinField(entry, ["pin"], makeRenderCtx({}, { board: board() }));

    const adc = optByValue(result, 32);
    const noAdc = optByValue(result, 25);
    expect(adc, "ADC pin present").toBeDefined();
    expect(noAdc, "non-ADC pin still present, not hidden").toBeDefined();
    // A missing capability is NOT a warning (untagged != incapable); the
    // grouping alone conveys it.
    expect(String(adc!.class)).not.toContain("pin-option--warn");
    expect(String(noAdc!.class)).not.toContain("pin-option--warn");
    expect(noAdc!["?disabled"]).not.toBe(true);
    // Supports / Other / Reserved split renders dividers.
    expect(findTemplatesByAnchor(result, "wa-divider").length).toBeGreaterThan(0);
  });

  it("softens an input-only pin on an output field to a selectable warning", () => {
    const entry = makeEntry(ConfigEntryType.PIN, {
      key: "pin",
      required: true,
      pin_features: [],
      pin_mode: PinMode.OUTPUT,
    });
    const result = renderPinField(entry, ["pin"], makeRenderCtx({}, { board: board() }));

    const inputOnly = optByValue(result, 34);
    expect(inputOnly).toBeDefined();
    expect(String(inputOnly!.class)).toContain("pin-option--warn");
    expect(inputOnly!["?disabled"]).not.toBe(true);
  });

  it("keeps a board-unavailable pin disabled (Reserved)", () => {
    const entry = makeEntry(ConfigEntryType.PIN, {
      key: "pin",
      required: true,
      pin_features: [],
    });
    const result = renderPinField(entry, ["pin"], makeRenderCtx({}, { board: board() }));

    expect(optByValue(result, 6)!["?disabled"]).toBe(true);
  });

  it("renders one flat list (no divider) when nothing needs breaking out", () => {
    // No required features, no output requirement, no unavailable pins → every
    // pin is usable and selectable, so there's no Supports/Other/Reserved split.
    const flatBoard = makeTestBoard({
      pins: [makeBoardPin(16), makeBoardPin(17), makeBoardPin(18)],
    });
    const entry = makeEntry(ConfigEntryType.PIN, {
      key: "pin",
      required: true,
      pin_features: [],
    });
    const result = renderPinField(
      entry,
      ["pin"],
      makeRenderCtx({}, { board: flatBoard })
    );

    expect(findTemplatesByAnchor(result, "wa-divider").length).toBe(0);
  });
});
