import { describe, expect, it, vi } from "vitest";
import {
  parsePinGpio,
  renderPinField,
} from "../../../src/components/device/config-entry-pin-renderer.js";
import { ConfigEntryType, type ConfigEntry } from "../../../src/api/types.js";
import {
  extractAttributeBindings,
  findTemplatesByAnchor,
} from "../../_lit-template-walker.js";
import { makeEntry, makeRenderCtx } from "./_renderer-fixtures.js";

describe("parsePinGpio", () => {
  it("accepts bare integers", () => {
    expect(parsePinGpio(12)).toBe(12);
    expect(parsePinGpio(0)).toBe(0);
  });

  it("accepts GPIO-prefixed strings, case-insensitively", () => {
    expect(parsePinGpio("GPIO13")).toBe(13);
    expect(parsePinGpio("gpio5")).toBe(5);
    expect(parsePinGpio("  GPIO2  ")).toBe(2);
  });

  it("accepts plain numeric strings", () => {
    expect(parsePinGpio("7")).toBe(7);
    expect(parsePinGpio("0")).toBe(0);
  });

  it("extracts the GPIO from a long-form pin block", () => {
    // The Sonoff Basic front-panel button preset locks the pin as a
    // structured ESPHome pin block (number + mode + inverted). Without
    // recognising the `number` field the dropdown rendered blank even
    // though the underlying value was correct.
    expect(
      parsePinGpio({
        number: 0,
        mode: { input: true, pullup: true },
        inverted: true,
      })
    ).toBe(0);
    expect(parsePinGpio({ number: 13 })).toBe(13);
    expect(parsePinGpio({ number: "GPIO4" })).toBe(4);
  });

  it("returns null for unparseable values", () => {
    expect(parsePinGpio(null)).toBeNull();
    expect(parsePinGpio(undefined)).toBeNull();
    expect(parsePinGpio("")).toBeNull();
    expect(parsePinGpio("not a pin")).toBeNull();
    expect(parsePinGpio({})).toBeNull();
    expect(parsePinGpio({ number: "nope" })).toBeNull();
    expect(parsePinGpio([])).toBeNull();
    expect(parsePinGpio(Number.NaN)).toBeNull();
  });
});

describe("renderPinField wa-select binding", () => {
  // The form's ``_syncSelectValues`` clears ``wa-select.value`` to
  // ``""`` for any non-primitive value (transient autocompletion
  // state, the long-form pin block, …). PIN renderers can
  // legitimately carry an object value
  // (``{ number: GPIO33, mode: INPUT_PULLUP, inverted: false }``),
  // so they MUST opt out of that generic sync via
  // ``data-no-value-sync`` — which routes the form to
  // ``_syncSelectedAttr`` instead. ``_syncSelectedAttr`` reads the
  // option Lit's ``?selected`` binding marked and pushes its
  // value onto the parent after wa-select's first paint; that's
  // the generic mechanism every "non-primitive value" renderer
  // uses (FLOAT_WITH_UNIT's unit picker is the other one), so
  // adding new structured shapes doesn't grow the form's
  // per-type knowledge.
  it("opts out of the generic sync via data-no-value-sync on the wa-select", () => {
    const ctx = makeRenderCtx({ pin: 0 });
    const result = renderPinField(
      makeEntry(ConfigEntryType.PIN, { key: "pin", required: true, pin_features: [] }),
      ["pin"],
      ctx
    );

    const selects = findTemplatesByAnchor(result, "<wa-select");
    expect(selects.length, "wa-select must be in the renderer's output").toBe(1);
    const tag = selects[0];

    // ``data-no-value-sync`` is a bare attribute (no ``${...}``
    // expression), so it lives in the template's static strings.
    // Joining with a sentinel keeps consecutive strings from
    // accidentally fusing into a false-positive match.
    const staticParts = tag.strings.join("§");
    expect(
      /\bdata-no-value-sync\b/.test(staticParts),
      "wa-select must carry data-no-value-sync to opt out of _syncSelectValues"
    ).toBe(true);

    // Pin the inverse: don't bind ``.value=`` on the parent. The
    // generic sync would clobber it (object value → cleared to
    // ""), and the ``data-no-value-sync`` path is the canonical
    // mechanism — having both creates two competing sources of
    // truth and confuses the next maintainer.
    const bindings = extractAttributeBindings(tag);
    expect(
      ".value" in bindings,
      "wa-select must not have a property binding to .value alongside data-no-value-sync"
    ).toBe(false);
  });
});

describe("renderPinField long-form Advanced disclosure", () => {
  // The catalog's _pin_long_form_extras (esphome/device-builder#430)
  // attaches mode-flag + inverted children to every type=pin entry.
  // Without rendering them under an Advanced section the visual
  // editor stays short-form-only and issue #420 (binary_sensor.gpio
  // pullup not configurable) persists.

  const makeLongFormChildren = (): ConfigEntry[] =>
    [
      {
        key: "mode",
        type: ConfigEntryType.NESTED,
        label: "Mode",
        config_entries: [
          {
            key: "input",
            type: ConfigEntryType.BOOLEAN,
            label: "Input",
          } as ConfigEntry,
          {
            key: "pullup",
            type: ConfigEntryType.BOOLEAN,
            label: "Pullup",
          } as ConfigEntry,
        ],
      } as ConfigEntry,
      {
        key: "inverted",
        type: ConfigEntryType.BOOLEAN,
        label: "Inverted",
      } as ConfigEntry,
    ] as never;

  it("omits the Advanced toggle when the entry has no nested children", () => {
    // Pre-#430 catalogs (or future entries that opt out by clearing
    // config_entries) keep the simple short-form picker — no
    // disclosure rendered, no surprise UI shift after a catalog
    // regen.
    const ctx = makeRenderCtx({ pin: 0 });
    const result = renderPinField(
      makeEntry(ConfigEntryType.PIN, {
        key: "pin",
        required: true,
        config_entries: null,
      }),
      ["pin"],
      ctx
    );
    expect(findTemplatesByAnchor(result, "<button").length).toBe(0);
  });

  it("renders an Advanced toggle when the entry carries long-form children", () => {
    const ctx = makeRenderCtx({ pin: 0 });
    const result = renderPinField(
      makeEntry(ConfigEntryType.PIN, {
        key: "pin",
        required: true,
        config_entries: makeLongFormChildren(),
      }),
      ["pin"],
      ctx
    );
    const toggles = findTemplatesByAnchor(result, "<button");
    expect(toggles.length, "Advanced toggle button must render").toBe(1);
    // No call to renderEntry yet — children only render when the
    // user opens the disclosure.
    expect(ctx.renderEntry).not.toHaveBeenCalled();
  });

  it("renders the long-form children when the disclosure is open", () => {
    // Toggle is keyed on `${path}:pin-advanced`; populating the
    // open-set simulates the user having clicked open.
    const openSet = new Set<string>(["pin:pin-advanced"]);
    const ctx = makeRenderCtx(
      { pin: { number: "GPIO5" } },
      { overrides: { nestedOpenSections: openSet } }
    );
    const children = makeLongFormChildren();
    renderPinField(
      makeEntry(ConfigEntryType.PIN, {
        key: "pin",
        required: true,
        config_entries: children,
      }),
      ["pin"],
      ctx
    );
    // ``mode`` and ``inverted`` both rendered, each at its nested
    // path under the pin field. Order-sensitive — ``mode`` first
    // matches the catalog's emission order, which the form's
    // tab-order convention follows.
    expect(ctx.renderEntry).toHaveBeenNthCalledWith(1, children[0], ["pin", "mode"]);
    expect(ctx.renderEntry).toHaveBeenNthCalledWith(2, children[1], ["pin", "inverted"]);
  });

  it("promotes the pin value to long form when the user opens Advanced", () => {
    // Short-form value: opening Advanced needs to rewrite ``pin: 5``
    // to ``pin: { number: 5 }`` so the subsequent ``setIn`` on a
    // nested flag (``pin.mode.pullup``) doesn't clobber the GPIO.
    // Without this promotion, flipping the first flag would silently
    // drop the user's pin selection.
    const ctx = makeRenderCtx({ pin: "GPIO5" });
    const result = renderPinField(
      makeEntry(ConfigEntryType.PIN, {
        key: "pin",
        required: true,
        config_entries: makeLongFormChildren(),
      }),
      ["pin"],
      ctx
    );
    const toggle = findTemplatesByAnchor(result, "<button")[0];
    const onClick = extractAttributeBindings(toggle)["@click"] as () => void;
    onClick();
    // Two effects in order: open the disclosure, then promote the
    // value. The promotion's emitChange writes to the same path
    // with the long-form mapping, preserving the existing GPIO.
    expect(ctx.toggleNested).toHaveBeenCalledWith("pin:pin-advanced");
    expect(ctx.emitChange).toHaveBeenCalledWith(["pin"], { number: "GPIO5" });
  });

  it("skips the promotion when the value is already long-form", () => {
    // Reopening Advanced on an already-long-form pin must not
    // overwrite the user's existing flags with ``{ number: ... }``
    // — that would silently undo every Advanced setting they made.
    const ctx = makeRenderCtx({
      pin: { number: "GPIO5", mode: { pullup: true }, inverted: true },
    });
    const result = renderPinField(
      makeEntry(ConfigEntryType.PIN, {
        key: "pin",
        required: true,
        config_entries: makeLongFormChildren(),
      }),
      ["pin"],
      ctx
    );
    const toggle = findTemplatesByAnchor(result, "<button")[0];
    const onClick = extractAttributeBindings(toggle)["@click"] as () => void;
    onClick();
    // Toggle still fires (the user wants the disclosure to open),
    // but no promotion event — the value already has the right
    // shape.
    expect(ctx.toggleNested).toHaveBeenCalledWith("pin:pin-advanced");
    expect(ctx.emitChange).not.toHaveBeenCalled();
  });

  it("routes pin-select changes to ``path.number`` on a long-form value", () => {
    // After the user has expanded Advanced and set a flag, the
    // pin value is in long-form. A subsequent GPIO change from
    // the picker has to write to ``pin.number`` — writing to bare
    // ``pin`` would replace the whole mapping with the new GPIO
    // string and drop every flag the user set.
    const ctx = makeRenderCtx({
      pin: { number: "GPIO5", mode: { pullup: true } },
    });
    const result = renderPinField(
      makeEntry(ConfigEntryType.PIN, {
        key: "pin",
        required: true,
        config_entries: makeLongFormChildren(),
      }),
      ["pin"],
      ctx
    );
    const select = findTemplatesByAnchor(result, "<wa-select")[0];
    const onChange = extractAttributeBindings(select)["@change"] as (e: Event) => void;
    // Synthesise the pick event the way wa-select dispatches it.
    onChange({ target: { value: "GPIO12" } } as never);
    expect(ctx.emitChange).toHaveBeenCalledWith(["pin", "number"], "GPIO12");
  });

  it("routes pin-select changes to bare ``path`` on a short-form value", () => {
    // Default short-form value: the picker writes to bare ``pin``
    // (today's behaviour, preserved for every config that hasn't
    // touched Advanced). A regression that always wrote to
    // ``pin.number`` would silently break every existing pin field
    // that doesn't have an open disclosure.
    const ctx = makeRenderCtx({ pin: 0 });
    const result = renderPinField(
      makeEntry(ConfigEntryType.PIN, {
        key: "pin",
        required: true,
        config_entries: makeLongFormChildren(),
      }),
      ["pin"],
      ctx
    );
    const select = findTemplatesByAnchor(result, "<wa-select")[0];
    const onChange = extractAttributeBindings(select)["@change"] as (e: Event) => void;
    onChange({ target: { value: "GPIO12" } } as never);
    expect(ctx.emitChange).toHaveBeenCalledWith(["pin"], "GPIO12");
  });

  it("disables the Advanced toggle when the field is disabled", () => {
    // Locked board presets (Sonoff Basic's front-panel button etc.)
    // mark the pin field disabled. The Advanced toggle has to
    // mirror that — without the disabled binding the user can
    // open the disclosure on a locked field, and the click handler
    // would fire the promotion ``emitChange`` and rewrite the
    // locked value.
    const ctx = makeRenderCtx({ pin: 5 }, { overrides: { disabled: true } });
    const result = renderPinField(
      makeEntry(ConfigEntryType.PIN, {
        key: "pin",
        required: true,
        config_entries: makeLongFormChildren(),
      }),
      ["pin"],
      ctx
    );
    const toggle = findTemplatesByAnchor(result, "<button")[0];
    const bindings = extractAttributeBindings(toggle);
    expect(
      "?disabled" in bindings,
      "Advanced toggle must carry a ?disabled binding"
    ).toBe(true);
    expect(bindings["?disabled"], "binding must reflect the field-disabled state").toBe(
      true
    );
  });

  it("does not promote or toggle when the disabled handler is invoked", () => {
    // Defence-in-depth: even when ``?disabled`` is set the click
    // handler is still wired (the framework / accessibility tooling
    // / a synthetic event from a test could fire it). Confirm the
    // handler short-circuits before mutating state.
    const ctx = makeRenderCtx({ pin: "GPIO5" }, { overrides: { disabled: true } });
    const result = renderPinField(
      makeEntry(ConfigEntryType.PIN, {
        key: "pin",
        required: true,
        config_entries: makeLongFormChildren(),
      }),
      ["pin"],
      ctx
    );
    const toggle = findTemplatesByAnchor(result, "<button")[0];
    const onClick = extractAttributeBindings(toggle)["@click"] as () => void;
    onClick();
    expect(ctx.toggleNested).not.toHaveBeenCalled();
    expect(ctx.emitChange).not.toHaveBeenCalled();
  });

  it("filters long-form children through ctx.filterRenderable", () => {
    // Every other nested renderer applies ``filterRenderable`` so
    // requiredOnly / showAdvanced / platform-visibility rules hide
    // sub-fields the rest of the form has hidden. Skipping the
    // filter here would let the long-form disclosure leak fields
    // the catalog has marked advanced or gated by platform.
    const openSet = new Set<string>(["pin:pin-advanced"]);
    const filterMock = vi.fn((entries: ConfigEntry[]) => entries.slice(0, 1));
    const ctx = makeRenderCtx(
      { pin: { number: "GPIO5" } },
      {
        overrides: {
          nestedOpenSections: openSet,
          filterRenderable: filterMock as never,
        },
      }
    );
    const children = makeLongFormChildren();
    renderPinField(
      makeEntry(ConfigEntryType.PIN, {
        key: "pin",
        required: true,
        config_entries: children,
      }),
      ["pin"],
      ctx
    );
    // Filter received the full children list; only the survivor
    // (the first child) gets handed to renderEntry. A regression
    // that bypassed ``filterRenderable`` would render both
    // children and the assertion below would catch the second
    // one.
    expect(filterMock).toHaveBeenCalledWith(children, expect.anything());
    expect(ctx.renderEntry).toHaveBeenCalledTimes(1);
    expect(ctx.renderEntry).toHaveBeenCalledWith(children[0], ["pin", "mode"]);
  });

  it("omits the Advanced disclosure when filterRenderable hides every child", () => {
    // requiredOnly mode (the add-component dialog) hides everything
    // marked advanced. The pin extras are all advanced, so the
    // whole disclosure should disappear — rendering an empty
    // toggle would invite the user to expand into nothing.
    const filterMock = vi.fn(() => [] as ConfigEntry[]);
    const ctx = makeRenderCtx(
      { pin: 0 },
      { overrides: { filterRenderable: filterMock as never } }
    );
    const result = renderPinField(
      makeEntry(ConfigEntryType.PIN, {
        key: "pin",
        required: true,
        config_entries: makeLongFormChildren(),
      }),
      ["pin"],
      ctx
    );
    expect(findTemplatesByAnchor(result, "<button").length).toBe(0);
  });
});
