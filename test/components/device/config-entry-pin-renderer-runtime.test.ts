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
 */
import { describe, expect, it, vi } from "vitest";
import type { TemplateResult } from "lit";
import { renderPinField } from "../../../src/components/device/config-entry-pin-renderer.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import { ConfigEntryType } from "../../../src/api/types.js";
import type { BoardCatalogEntry, BoardPin, ConfigEntry } from "../../../src/api/types.js";

function makeBoard(): BoardCatalogEntry {
  const pin = (gpio: number, features: string[] = ["input", "output"]): BoardPin => ({
    gpio,
    label: `GPIO${gpio}`,
    features,
    available: true,
    occupied_by: null,
    notes: null,
  });
  return {
    id: "esp32-test",
    name: "ESP32 Test",
    description: "",
    manufacturer: "Espressif",
    esphome: { platform: "esp32", board: "esp32dev" } as never,
    hardware: { connectivity: ["wifi"] } as never,
    tags: [],
    pins: [pin(0), pin(2), pin(33)],
  } as never;
}

function makeCtx(values: unknown): RenderCtx {
  return {
    localize: ((k: string) => k) as never,
    disabled: false,
    yaml: "",
    fromLine: 0,
    board: makeBoard(),
    requiredOnly: false,
    nestedOpenSections: new Set(),
    getAt: (path) => {
      let cur: unknown = values;
      for (const key of path) {
        if (cur && typeof cur === "object") {
          cur = (cur as Record<string, unknown>)[key];
        } else {
          return undefined;
        }
      }
      return cur;
    },
    errorAt: () => null,
    emitChange: vi.fn(),
    toggleNested: vi.fn(),
    requestAddComponent: vi.fn(),
    scopeValues: () => ({}),
    filterRenderable: (entries) => entries,
    renderEntry: vi.fn(),
    getPendingUnit: () => undefined,
    setPendingUnit: vi.fn(),
    getPendingNumeric: () => undefined,
    setPendingNumeric: vi.fn(),
  } as never;
}

function makePinEntry(): ConfigEntry {
  // ``pin_features`` is the backend's flat string list of pin
  // capabilities the field requires (``input`` / ``output`` /
  // ``adc`` / …). Leave it empty so every test board pin
  // qualifies — the renderer's ``required.every(...)`` filter
  // over an empty array is vacuously true.
  return {
    key: "pin",
    type: ConfigEntryType.PIN,
    label: "Pin",
    required: true,
    pin_features: [],
  } as never;
}

/** Walk a Lit ``TemplateResult`` recursively, calling *visit* on every
 *  inner result. Used to find every wa-option's interpolated bindings
 *  without rendering to a real DOM. */
function visitTemplates(
  result: unknown,
  visit: (r: TemplateResult) => void,
): void {
  if (!result) return;
  if (Array.isArray(result)) {
    for (const r of result) visitTemplates(r, visit);
    return;
  }
  if (typeof result === "object" && "_$litType$" in (result as object)) {
    const t = result as TemplateResult;
    visit(t);
    visitTemplates(t.values, visit);
  }
}

interface OptionBindings {
  value: string;
  selected: boolean;
  label: string;
}

/** Find every wa-option in the template by string-matching on the
 *  template's static parts and pairing each match with its bound values. */
function extractOptions(template: TemplateResult): OptionBindings[] {
  const options: OptionBindings[] = [];
  visitTemplates(template, (t) => {
    const joined = t.strings.join("§");
    const optionAnchor = "<wa-option";
    if (!joined.includes(optionAnchor)) return;
    // The pin renderer's wa-option template has 6 expression slots,
    // in order: class, value=, .label=, ?selected=, ?disabled=, title=
    // (followed by slot content slots after the ``>``).
    const valueIdx = 1; // class is slot 0, value is slot 1
    const labelIdx = 2;
    const selectedIdx = 3;
    options.push({
      value: String(t.values[valueIdx]),
      selected: Boolean(t.values[selectedIdx]),
      label: String(t.values[labelIdx]),
    });
  });
  return options;
}

describe("renderPinField — long-form pin block selection", () => {
  it("marks the GPIO33 option ?selected=true when the YAML uses { number: 'GPIO33', ... }", () => {
    const values = {
      pin: {
        number: "GPIO33",
        mode: "INPUT_PULLUP",
        inverted: false,
      },
    };
    const ctx = makeCtx(values);
    const result = renderPinField(makePinEntry(), ["pin"], ctx);

    const options = extractOptions(result);
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
    const values = { pin: { number: 33 } };
    const ctx = makeCtx(values);
    const result = renderPinField(makePinEntry(), ["pin"], ctx);

    const selected = extractOptions(result).filter((o) => o.selected);
    expect(selected.length).toBe(1);
    expect(selected[0].value).toBe("GPIO33");
  });

  it("does NOT select any option for an unparseable long-form value", () => {
    // Defensive: if number is missing / garbage, no option should be
    // marked selected (rather than silently picking the first or
    // claiming GPIO0).
    const values = { pin: { mode: "INPUT", inverted: false } };
    const ctx = makeCtx(values);
    const result = renderPinField(makePinEntry(), ["pin"], ctx);

    const selected = extractOptions(result).filter((o) => o.selected);
    expect(selected.length).toBe(0);
  });
});
