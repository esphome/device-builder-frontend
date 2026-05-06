import { describe, expect, it } from "vitest";
import {
  parsePinGpio,
  renderPinField,
} from "../../../src/components/device/config-entry-pin-renderer.js";
import { ConfigEntryType } from "../../../src/api/types.js";
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
      }),
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
      ctx,
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
      "wa-select must carry data-no-value-sync to opt out of _syncSelectValues",
    ).toBe(true);

    // Pin the inverse: don't bind ``.value=`` on the parent. The
    // generic sync would clobber it (object value → cleared to
    // ""), and the ``data-no-value-sync`` path is the canonical
    // mechanism — having both creates two competing sources of
    // truth and confuses the next maintainer.
    const bindings = extractAttributeBindings(tag);
    expect(
      ".value" in bindings,
      "wa-select must not have a property binding to .value alongside data-no-value-sync",
    ).toBe(false);
  });
});
