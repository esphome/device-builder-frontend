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
import { renderPinField } from "../../../src/components/device/config-entry-pin-renderer.js";
import { ConfigEntryType } from "../../../src/api/types.js";
import { findElementBindings, makeEntry, makeRenderCtx } from "./_renderer-fixtures.js";

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
