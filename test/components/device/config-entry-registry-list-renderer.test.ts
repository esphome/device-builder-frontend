// @vitest-environment happy-dom
/**
 * Tests for ``<esphome-registry-list>`` (the REGISTRY_LIST renderer,
 * #941). The element fetches the named catalog via the automation-
 * catalog cache and renders one row per item with a per-row type
 * picker plus add / remove buttons; tests pin the row count, the
 * picker bindings (value + included options), and the
 * ``emitChange`` payloads for add / remove / rename.
 *
 * Happy-dom is needed so the custom element registers and renders
 * into a real shadow DOM; the function-level wrapper
 * ``renderRegistryListField`` is exercised via the same path.
 */
import { describe, expect, it, vi } from "vitest";
import { ConfigEntryType, type LightEffect } from "../../../src/api/types.js";
import "../../../src/components/device/config-entry-renderers/registry-list.js";
import { type ESPHomeRegistryList } from "../../../src/components/device/config-entry-renderers/registry-list.js";
import { makeEntry, makeRenderCtx } from "./_renderer-fixtures.js";

const STUB_CATALOG: LightEffect[] = [
  { id: "addressable_rainbow", name: "Rainbow", config_entries: [], applies_to: [] },
  { id: "pulse", name: "Pulse", config_entries: [], applies_to: [] },
];

type EmitFn = (path: string[], value: unknown) => void;
type EmitMock = EmitFn & ReturnType<typeof vi.fn>;

function mount(
  values: { effects?: unknown },
  emit?: EmitMock
): { el: ESPHomeRegistryList; emit: EmitMock } {
  const emitFn = (emit ?? vi.fn()) as EmitMock;
  const el = document.createElement("esphome-registry-list") as ESPHomeRegistryList;
  el.entry = makeEntry(ConfigEntryType.REGISTRY_LIST, {
    key: "effects",
    label: "Effects",
    registry: "light_effects",
    multi_value: true,
  });
  el.path = ["effects"];
  el.ctx = makeRenderCtx(values, { overrides: { emitChange: emitFn } });
  document.body.append(el);
  // Mounting fires the element's connectedCallback which kicks the
  // catalog fetch; we shortcut by setting the cached catalog directly
  // via the internal state property so each test isolates from the
  // module-level cache.
  (el as unknown as { _catalog: LightEffect[] })._catalog = STUB_CATALOG;
  el.requestUpdate();
  return { el, emit: emitFn };
}

describe("renderRegistryListField — row rendering", () => {
  it("renders one row per item with the picker tied to the current id", async () => {
    const { el } = mount({
      effects: [{ addressable_rainbow: null }, { pulse: { update_interval: "2s" } }],
    });
    await el.updateComplete;
    const rows = el.shadowRoot!.querySelectorAll(".registry-list-row");
    expect(rows.length).toBe(2);
    const firstPicker = rows[0].querySelector("wa-select");
    expect((firstPicker as unknown as { value: string }).value).toBe(
      "addressable_rainbow"
    );
    const secondPicker = rows[1].querySelector("wa-select");
    expect((secondPicker as unknown as { value: string }).value).toBe("pulse");
  });

  it("renders an empty state when the array is empty", async () => {
    const { el } = mount({ effects: [] });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll(".registry-list-row").length).toBe(0);
    // The shared list-empty hint surfaces "No items yet" via the
    // ``device.multi_value_empty`` localize key.
    expect(el.shadowRoot!.textContent).toContain("device.multi_value_empty");
  });

  it("falls back to the cached effect's id when the catalog drops it", async () => {
    // A legacy config carrying an effect the schema later removed —
    // the picker still surfaces it as an option so the user's value
    // round-trips on save instead of silently disappearing.
    const { el } = mount({ effects: [{ legacy_effect: null }] });
    await el.updateComplete;
    const options = el.shadowRoot!.querySelectorAll("wa-option");
    const values = Array.from(options).map((o) =>
      (o as HTMLElement).getAttribute("value")
    );
    expect(values).toContain("legacy_effect");
    expect(values).toContain("addressable_rainbow");
    expect(values).toContain("pulse");
  });
});

describe("renderRegistryListField — emitChange contract", () => {
  it("Add button appends a seed item using the catalog's first id", async () => {
    const { el, emit } = mount({ effects: [{ pulse: null }] });
    await el.updateComplete;
    const addButton = el.shadowRoot!.querySelector(".multi-add") as HTMLButtonElement;
    addButton.click();
    expect(emit).toHaveBeenCalledWith(
      ["effects"],
      [{ pulse: null }, { addressable_rainbow: null }]
    );
  });

  it("Remove button splices the targeted row", async () => {
    const { el, emit } = mount({
      effects: [{ addressable_rainbow: null }, { pulse: null }],
    });
    await el.updateComplete;
    const firstRemove = el.shadowRoot!.querySelectorAll(
      ".registry-list-row .multi-btn"
    )[0] as HTMLButtonElement;
    firstRemove.click();
    expect(emit).toHaveBeenCalledWith(["effects"], [{ pulse: null }]);
  });

  it("Picker change renames the row, preserving its params", async () => {
    // Pre-#941, rename was destructive — params for the old effect
    // would have to be re-entered. The renderer carries them across
    // so a user who's experimenting with effect types doesn't lose
    // their tuning on every picker change.
    const { el, emit } = mount({
      effects: [{ addressable_rainbow: { speed: 50 } }],
    });
    await el.updateComplete;
    const picker = el.shadowRoot!.querySelector(
      ".registry-list-row wa-select"
    ) as HTMLSelectElement & { value: string };
    picker.value = "pulse";
    picker.dispatchEvent(new Event("change"));
    expect(emit).toHaveBeenCalledWith(["effects"], [{ pulse: { speed: 50 } }]);
  });
});
