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
  values: { effects?: unknown; filters?: unknown },
  options: {
    emit?: EmitMock;
    registry?: string | null;
    key?: string;
    catalog?: LightEffect[] | null;
  } = {}
): { el: ESPHomeRegistryList; emit: EmitMock } {
  const emitFn = (options.emit ?? vi.fn()) as EmitMock;
  const el = document.createElement("esphome-registry-list") as ESPHomeRegistryList;
  const key = options.key ?? "effects";
  el.entry = makeEntry(ConfigEntryType.REGISTRY_LIST, {
    key,
    label: "Effects",
    registry: options.registry === undefined ? "light_effects" : options.registry,
    multi_value: true,
  });
  el.path = [key];
  el.ctx = makeRenderCtx(values, { overrides: { emitChange: emitFn } });
  document.body.append(el);
  // Mounting fires the element's connectedCallback which kicks the
  // catalog fetch; shortcut by setting the cached catalog directly
  // via the internal state property so each test isolates from the
  // module-level cache. ``null`` keeps the loading state.
  const cached = options.catalog === undefined ? STUB_CATALOG : options.catalog;
  if (cached !== null) {
    (el as unknown as { _catalog: LightEffect[] })._catalog = cached;
  }
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

  it("formats option labels from the id, not the catalog's prefixed name", async () => {
    // The catalog stores ``name: 'Light → Addressable Rainbow'``
    // because ``_automation_label`` always emits ``Domain → Name``
    // for component-scoped entries — useful in the global automation
    // editor (hundreds of actions), redundant in a single-domain
    // picker already labelled "Effects". Titlecase from the id so
    // the row reads as the bare effect name.
    const { el } = mount({ effects: [{ addressable_rainbow: null }] });
    (el as unknown as { _catalog: LightEffect[] })._catalog = [
      {
        id: "addressable_rainbow",
        name: "Light → Addressable Rainbow",
        config_entries: [],
        applies_to: [],
      },
    ];
    el.requestUpdate();
    await el.updateComplete;
    const optionText = el.shadowRoot!.querySelector("wa-option")!.textContent?.trim();
    expect(optionText).toBe("Addressable Rainbow");
  });
});

describe("renderRegistryListField — emitChange contract", () => {
  it("Add button appends an empty row, not a preselected id", async () => {
    // Preselecting ``catalog[0].id`` (alphabetically ``adalight``)
    // landed effects the user didn't mean to pick AND those defaults
    // are often invalid for the parent component (``adalight`` only
    // applies to non-addressable RGB lights), so the backend
    // rejected the save with "Unable to find effect with the name".
    // Emit an empty mapping; the picker's placeholder prompts the
    // user to choose.
    const { el, emit } = mount({ effects: [{ pulse: null }] });
    await el.updateComplete;
    const addButton = el.shadowRoot!.querySelector(".multi-add") as HTMLButtonElement;
    addButton.click();
    expect(emit).toHaveBeenCalledWith(["effects"], [{ pulse: null }, {}]);
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

describe("renderRegistryListField — foreign-entry preservation", () => {
  it("Remove keeps non-editable entries verbatim (silent-data-loss fix)", async () => {
    // The values dict can carry foreign entries — strings, scalars,
    // a YamlRawValue from a parser bail — that the picker shouldn't
    // touch. Pre-fix ``asPolymorphicList`` filtered them out and the
    // next emit silently dropped them from disk.
    const foreign = "!secret legacy_effect";
    const { el, emit } = mount({
      effects: [foreign, { pulse: null }, { addressable_rainbow: null }],
    });
    await el.updateComplete;
    const firstRemove = el.shadowRoot!.querySelectorAll(
      ".registry-list-row .multi-btn"
    )[0] as HTMLButtonElement;
    firstRemove.click();
    expect(emit).toHaveBeenCalledWith(
      ["effects"],
      [foreign, { addressable_rainbow: null }]
    );
  });

  it("Add preserves trailing foreign entries", async () => {
    const foreign = "!secret legacy_effect";
    const { el, emit } = mount({
      effects: [{ pulse: null }, foreign],
    });
    await el.updateComplete;
    const addButton = el.shadowRoot!.querySelector(".multi-add") as HTMLButtonElement;
    addButton.click();
    expect(emit).toHaveBeenCalledWith(["effects"], [{ pulse: null }, {}, foreign]);
  });

  it("Multi-key items are skipped by the picker rather than truncated", async () => {
    // A malformed config carrying ``- {a: 1, b: 2}`` (two keys per
    // item) used to render with the picker showing only ``a`` and
    // silently drop ``b`` on the next save. Recognise multi-key
    // items as foreign so they pass through untouched.
    const malformed = { a: 1, b: 2 };
    const { el, emit } = mount({ effects: [malformed, { pulse: null }] });
    await el.updateComplete;
    const rows = el.shadowRoot!.querySelectorAll(".registry-list-row");
    // Only the single-key item renders a picker row.
    expect(rows.length).toBe(1);
    const remove = rows[0].querySelector(".multi-btn") as HTMLButtonElement;
    remove.click();
    expect(emit).toHaveBeenCalledWith(["effects"], [malformed]);
  });
});

describe("renderRegistryListField — status states", () => {
  it("unknown registry shows an explicit error, not a stand-in catalog", async () => {
    const { el } = mount({}, { registry: "made_up_registry" });
    await el.updateComplete;
    const txt = el.shadowRoot!.textContent ?? "";
    expect(txt).toContain("device.registry_list_unsupported");
    // No picker rows, no Add button — the field is read-only via YAML.
    expect(el.shadowRoot!.querySelectorAll(".registry-list-row").length).toBe(0);
    expect(el.shadowRoot!.querySelector(".multi-add")).toBeNull();
  });

  it("distinguishes loading from empty-catalog state", async () => {
    // Catalog null → fetch in flight → "loading".
    const loadingEl = mount({}, { catalog: null }).el;
    await loadingEl.updateComplete;
    expect(loadingEl.shadowRoot!.textContent).toContain("device.registry_list_loading");

    // Catalog [] → registry has no entries → distinct copy. Not a
    // permanent loading message.
    const emptyEl = mount({}, { catalog: [] }).el;
    await emptyEl.updateComplete;
    expect(emptyEl.shadowRoot!.textContent).toContain(
      "device.registry_list_empty_catalog"
    );
    expect(emptyEl.shadowRoot!.textContent).not.toContain("device.registry_list_loading");
  });

  it("disables the Add button while the catalog is loading or empty", async () => {
    const { el } = mount({}, { catalog: null });
    await el.updateComplete;
    const addButton = el.shadowRoot!.querySelector(".multi-add") as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);
  });
});

describe("renderRegistryListField — registry dispatch", () => {
  it("filter registry pulls from the filters cache, not light_effects", async () => {
    // Smoke test the REGISTRY_OPS dispatch on entry.registry: mounting
    // with ``registry: "filter"`` uses the filter cache, so a stub
    // filter catalog renders as picker options.
    const { el } = mount(
      { filters: [{ delta: null }] },
      {
        registry: "filter",
        key: "filters",
        catalog: [
          { id: "delta", name: "Delta", config_entries: [], applies_to: ["sensor"] },
          { id: "lambda", name: "Lambda", config_entries: [], applies_to: ["sensor"] },
        ],
      }
    );
    await el.updateComplete;
    const options = el.shadowRoot!.querySelectorAll("wa-option");
    const values = Array.from(options).map((o) =>
      (o as HTMLElement).getAttribute("value")
    );
    expect(values).toContain("delta");
    expect(values).toContain("lambda");
  });
});
