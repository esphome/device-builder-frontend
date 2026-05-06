/**
 * Runtime check that ``renderPinField`` actually does what PR #180
 * claims: with a long-form pin block in the YAML
 * (``{ number: 'GPIO33', mode: 'INPUT_PULLUP', inverted: false }``),
 * the rendered ``wa-select`` should land on the GPIO33 option as
 * selected, with the correct closed-state label.
 *
 * The shipped test in ``config-entry-pin-renderer.test.ts`` only
 * source-scans the renderer for ``data-no-value-sync`` and the
 * absence of ``.value=``. That doesn't prove the bug is gone —
 * the form's ``_syncSelectedAttr`` could be silently dropping
 * the value, the renderer's ``?selected`` could be on the wrong
 * option, or ``parsePinGpio`` could be returning ``null`` for
 * a shape we thought it handled. Walk the ``TemplateResult``
 * directly and assert that the option matching the YAML's GPIO
 * carries ``?selected=true`` and the right value.
 *
 * The walker, ctx factory, and option-binding extractor live in
 * ``test/_lit-template-walker.ts`` + ``./_renderer-fixtures.ts``
 * so future renderer tests can reuse them without rebuilding the
 * scaffolding.
 */
import { describe, expect, it } from "vitest";
import { renderPinField } from "../../../src/components/device/config-entry-pin-renderer.js";
import { ConfigEntryType } from "../../../src/api/types.js";
import {
  extractWaOptionBindings,
  makeEntry,
  makeRenderCtx,
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

describe("renderPinField — long-form pin block selection", () => {
  it("marks the GPIO33 option ?selected=true when the YAML uses { number: 'GPIO33', ... }", () => {
    const ctx = makeRenderCtx({
      pin: { number: "GPIO33", mode: "INPUT_PULLUP", inverted: false },
    });
    const result = renderPinField(pinEntry(), ["pin"], ctx);

    const options = extractWaOptionBindings(result);
    expect(options.length, "expected wa-options to be rendered").toBeGreaterThan(0);

    const selected = options.filter((o) => o.selected);
    expect(
      selected.length,
      `exactly one option should be selected; got ${selected.length} (${selected
        .map((s) => s.value)
        .join(", ")})`,
    ).toBe(1);
    expect(selected[0].value, "selected option value").toBe("GPIO33");
    expect(selected[0].label, "selected option label").toBe("GPIO33");
  });

  it("marks GPIO33 selected when YAML uses bare integer { number: 33 }", () => {
    const ctx = makeRenderCtx({ pin: { number: 33 } });
    const result = renderPinField(pinEntry(), ["pin"], ctx);

    const selected = extractWaOptionBindings(result).filter((o) => o.selected);
    expect(selected.length).toBe(1);
    expect(selected[0].value).toBe("GPIO33");
  });

  it("does NOT select any option for an unparseable long-form value", () => {
    // Defensive: if number is missing / garbage, no option should be
    // marked selected (rather than silently picking the first or
    // claiming GPIO0).
    const ctx = makeRenderCtx({ pin: { mode: "INPUT", inverted: false } });
    const result = renderPinField(pinEntry(), ["pin"], ctx);

    const selected = extractWaOptionBindings(result).filter((o) => o.selected);
    expect(selected.length).toBe(0);
  });
});
