/**
 * Shared form renderer for ConfigEntry schemas.
 *
 * Both the device section editor (`device-section-config.ts`) and the
 * "Add component" dialog (`add-component-form.ts`) point this element
 * at an array of ConfigEntry's; it handles dispatching to the right UI
 * for every entry type (string/number/boolean/select/combobox/pin/
 * id-reference/icon/textarea/multi-value/nested/map) and supports
 * recursive nested groups.
 *
 * The form is fully controlled — the owner passes `values` + `errors`
 * in, listens for `value-change` events, and merges the change back
 * into its own state. That keeps the form free of any persistence
 * concerns and lets each owner decide what "save" / "submit" means.
 */
import { consume } from "@lit/context";
import {
  mdiAlertCircleOutline,
  mdiChevronDown,
  mdiChevronUp,
  mdiClose,
  mdiOpenInNew,
  mdiPlus,
} from "@mdi/js";
import { html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { BoardCatalogEntry, ConfigEntry } from "../../api/types.js";
import { ConfigEntryType } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import {
  type ValidationError,
} from "../../util/config-validation.js";
import { filterRenderable } from "./config-entry-render-filter.js";
import { getIn, isPrimitiveOrNullish } from "../../util/nested-values.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/divider/divider.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";
import "@home-assistant/webawesome/dist/components/switch/switch.js";
import "../mdi-icon-picker.js";
import "./password-input.js";
import { configEntryFormStyles } from "./config-entry-form.styles.js";
import {
  labelFor,
  renderBooleanField,
  renderFloatWithUnitField,
  renderIconField,
  renderIdReferenceField,
  renderMapField,
  renderMultiValueField,
  renderNestedField,
  renderNumberField,
  renderPinField,
  renderSelectField,
  renderStringField,
  renderTextareaField,
  type RenderCtx,
} from "./config-entry-renderers.js";

registerMdiIcons({
  "alert-circle-outline": mdiAlertCircleOutline,
  "chevron-down": mdiChevronDown,
  "chevron-up": mdiChevronUp,
  close: mdiClose,
  "open-in-new": mdiOpenInNew,
  plus: mdiPlus,
});

/** Detail emitted with `value-change` events. */
export interface ConfigEntryValueChange {
  path: string[];
  value: unknown;
}

@customElement("esphome-config-entry-form")
export class ESPHomeConfigEntryForm extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** Schema entries to render (recursive — NESTED entries contain
   *  their own `config_entries`). */
  @property({ attribute: false })
  entries: ConfigEntry[] = [];

  /** Current form values keyed by entry key (nested as sub-objects).
   *  Owner-controlled — emits `value-change` to mutate. */
  @property({ attribute: false })
  values: Record<string, unknown> = {};

  /** Validation errors keyed by dotted path. */
  @property({ attribute: false })
  errors: Map<string, ValidationError> = new Map();

  /** Board metadata, used by the GPIO pin selector. */
  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  /** Disable all inputs (e.g. while saving / submitting). */
  @property({ type: Boolean })
  disabled = false;

  /** Show advanced fields. Owner is in charge of any toggle UI; the
   *  form just respects the flag. */
  @property({ type: Boolean, attribute: "show-advanced" })
  showAdvanced = false;

  /** Show only required entries (recursively into nested groups).
   *  Used by the add-component dialog so the user only fills the
   *  must-have fields up front. */
  @property({ type: Boolean, attribute: "required-only" })
  requiredOnly = false;

  /** Full device YAML — used by the ID reference picker (to discover
   *  existing components) and pin conflict detection. */
  @property()
  yaml = "";

  /** Section's start line in the YAML; used to skip the user's own
   *  pin from conflict detection. */
  @property({ type: Number, attribute: "from-line" })
  fromLine?: number;

  /** Top-level component keys present in the YAML — drives the
   *  `depends_on_component` visibility predicate. */
  @property({ attribute: false })
  presentComponents: Set<string> = new Set();

  @state()
  private _nestedOpenSections: Set<string> = new Set();

  /**
   * Transient unit choice for FLOAT_WITH_UNIT entries the user
   * picked before typing a numeric value. Keyed by dotted path.
   * `chooseDisplayUnit` reads this layer before falling back to
   * the catalog default, so the picker survives a rerender even
   * when the form value is still `""`.
   *
   * The setter (in `_buildCtx`) calls `requestUpdate()` because
   * a unit-only pick doesn't reach the form's value-change cycle
   * — no `emit()` happens — so Lit needs the explicit nudge.
   *
   * Cleared on `entries` change so a different component's picks
   * don't bleed across; otherwise superseded once a non-empty
   * `parsed.unit` from the form value beats the pending layer.
   */
  private _pendingUnits: Map<string, string> = new Map();

  /**
   * Transient raw-text buffer for FLOAT_WITH_UNIT magnitude inputs.
   * `<input type="number">` reads `""` from `.value` for
   * mid-typing intermediates (`"-"`, `"1e"`, `"1."`); Lit's
   * `.value=` property binding then re-writes `""` over the
   * partial text. The renderer reads from this buffer first so
   * partial input survives until the user produces a parseable
   * value (which lands in `this.values` normally) or blurs.
   */
  private _editingMagnitudes: Map<string, string> = new Map();

  static styles = [espHomeStyles, inputStyles, configEntryFormStyles];

  /**
   * Filter `entries` for rendering. Delegates to the shared
   * ``filterRenderable`` helper so the add-component form's
   * "is this error visible?" check (which mirrors the same rules)
   * can never drift from what's actually painted.
   */
  private _filterRenderable = (
    entries: ConfigEntry[],
    values: Record<string, unknown>,
  ): ConfigEntry[] =>
    filterRenderable(entries, values, {
      requiredOnly: this.requiredOnly,
      showAdvanced: this.showAdvanced,
      presentComponents: this.presentComponents,
    });

  protected render() {
    const ctx = this._buildCtx();
    const visible = this._filterRenderable(this.entries, this.values);
    return html`${visible.map((entry) =>
      this._renderEntry(entry, [entry.key], ctx),
    )}`;
  }

  /**
   * After every render, push the current value onto each <wa-select>
   * imperatively. This is a workaround for a wa-select quirk where
   * the value/selected wiring through Lit's template doesn't always
   * land — especially on the first paint, when wa-select reads its
   * value before the slotted options are connected. Each field div
   * carries a `data-field-key` (the dotted path) so we can look up
   * the right value for its select.
   *
   * We wait for each select's `updateComplete` (and one frame after
   * that) to make sure wa-select's own first-render bookkeeping —
   * `handleDefaultSlotChange`, `setSelectedOptions`, etc. — has run
   * before we set `.value`. Otherwise our imperative set fights with
   * wa-select's own initial value resolution and the displayed label
   * stays blank.
   */
  protected willUpdate(changed: PropertyValues) {
    // A different entry list means the form was re-targeted to a
    // different component (e.g. the dep-flow detour swapping
    // ES7210 for i2c). Drop transient unit picks from the previous
    // shape so they don't bleed into unrelated paths.
    if (changed.has("entries") && changed.get("entries") !== undefined) {
      this._pendingUnits.clear();
      this._editingMagnitudes.clear();
    }
  }

  protected updated(changed: PropertyValues) {
    super.updated(changed);
    void this._syncSelectValues();
  }

  private async _syncSelectValues() {
    if (!this.shadowRoot) return;
    const fields = this.shadowRoot.querySelectorAll<HTMLElement>(
      "[data-field-key]",
    );
    for (const field of fields) {
      const select = field.querySelector("wa-select") as
        | (HTMLElement & {
            value: string | string[] | null;
            updateComplete?: Promise<unknown>;
          })
        | null;
      if (!select) continue;
      // FLOAT_WITH_UNIT widgets carry a wa-select for the unit picker
      // alongside a number input. The select's value is the unit half
      // of the combined YAML string, not the path's value — let the
      // renderer's `?selected` decide and sync the unit imperatively
      // (wa-select drops `?selected` set by Lit if its first paint
      // beats the slot connection).
      if (select.hasAttribute("data-no-value-sync")) {
        await this._syncSelectedAttr(select);
        continue;
      }
      // Let wa-select finish its own initial update before we set
      // anything — otherwise its post-render selectionChanged
      // overwrites whatever we wrote.
      if (select.updateComplete) {
        try {
          await select.updateComplete;
        } catch {
          // ignore
        }
      }
      const key = field.getAttribute("data-field-key");
      if (!key) continue;
      const path = key.split(".");
      const value = getIn(this.values, path);
      // ``wa-select`` only carries primitive values; if the YAML
      // path resolves to an object (transient state from a partial
      // edit — e.g. autocompletion just inserted ``then:\n  - ``
      // and js-yaml produced an empty mapping at this position),
      // ``String(value)`` can throw "Cannot convert object to
      // primitive value" for null-prototype objects. Clear any
      // stale selection rather than leaving the previous primitive
      // displayed against a now-non-primitive YAML state.
      if (!isPrimitiveOrNullish(value)) {
        const current = Array.isArray(select.value)
          ? select.value[0] ?? ""
          : select.value ?? "";
        if (current !== "") select.value = "";
        continue;
      }
      const raw = String(value ?? "");
      // wa-select filters its `value` against the exact string of an
      // option's `value`; case mismatches between YAML and catalog
      // would silently drop the value. Look up the matching option
      // case-insensitively and feed wa-select the option's verbatim
      // value so the lookup succeeds.
      //
      // Pin entries are a second mismatch: the seeded YAML value is
      // a bare int (`9`, from `seedBoardPinDefaults` reading the
      // board manifest's pin features) or a string alias (`"SCL"`),
      // but the option values are always `"GPIOn"`. Normalise both
      // into the bare GPIO number for comparison so a freshly seeded
      // i2c bus on ESP32-C3 lands on the right option instead of
      // showing an empty select.
      const options = Array.from(
        select.querySelectorAll<HTMLElement & { value: string }>("wa-option"),
      );
      const rawGpio = raw.match(/^\s*(?:GPIO)?(\d+)\s*$/i)?.[1];
      const findByValue = (v: string) =>
        options.find((o) => o.value?.toLowerCase() === v.toLowerCase());
      const matched = raw
        ? (findByValue(raw) ??
            (rawGpio ? findByValue(`GPIO${rawGpio}`) : undefined))
        : null;
      const desired = matched?.value ?? raw;
      const current = Array.isArray(select.value)
        ? select.value[0] ?? ""
        : select.value ?? "";
      if (current !== desired) {
        select.value = desired;
      }
    }
  }

  /**
   * Push the option marked `selected` onto `select.value` after
   * wa-select's first paint. Used for selects whose value isn't
   * bound to the form's path (FLOAT_WITH_UNIT's unit picker), where
   * the `?selected` Lit binding loses the race against wa-select's
   * own selectionChanged hook.
   */
  private async _syncSelectedAttr(
    select: HTMLElement & {
      value: string | string[] | null;
      updateComplete?: Promise<unknown>;
    },
  ) {
    if (select.updateComplete) {
      try {
        await select.updateComplete;
      } catch {
        // ignore
      }
    }
    const selectedOption = select.querySelector<
      HTMLElement & { value: string }
    >("wa-option[selected]");
    const desired = selectedOption?.value ?? "";
    if (!desired) return;
    const current = Array.isArray(select.value)
      ? select.value[0] ?? ""
      : select.value ?? "";
    if (current !== desired) {
      select.value = desired;
    }
  }

  // ─── Entry dispatch ─────────────────────────────────────────────

  private _renderEntry(entry: ConfigEntry, path: string[], ctx: RenderCtx) {
    if (entry.type === ConfigEntryType.DIVIDER) {
      return html`<wa-divider></wa-divider>`;
    }
    if (entry.type === ConfigEntryType.LABEL) {
      return html`<p class="label-entry">${labelFor(entry, ctx)}</p>`;
    }
    if (entry.type === ConfigEntryType.ALERT) {
      return html`<div class="alert-entry">${labelFor(entry, ctx)}</div>`;
    }
    if (entry.type === ConfigEntryType.NESTED) {
      return renderNestedField(entry, path, ctx);
    }
    if (entry.type === ConfigEntryType.MAP) {
      return renderMapField(entry, path, ctx);
    }
    if (entry.multi_value) {
      return renderMultiValueField(entry, path, ctx);
    }
    // Any entry that points at another component renders as the ID
    // picker dropdown — `references_component` is the explicit
    // "this references another component" signal, independent of the
    // underlying type. (A binary light's `output:` field, for example,
    // is a STRING with `references_component: "output"`.)
    if (entry.references_component) {
      return renderIdReferenceField(entry, path, ctx);
    }
    if (entry.options && entry.options.length > 0) {
      return renderSelectField(entry, path, ctx);
    }
    switch (entry.type) {
      case ConfigEntryType.BOOLEAN:
        return renderBooleanField(entry, path, ctx);
      case ConfigEntryType.SELECT:
        return renderStringField(entry, "text", path, ctx);
      case ConfigEntryType.SECURE_STRING:
        return renderStringField(entry, "password", path, ctx);
      case ConfigEntryType.INTEGER:
      case ConfigEntryType.FLOAT:
        return renderNumberField(entry, path, ctx);
      case ConfigEntryType.FLOAT_WITH_UNIT:
        return renderFloatWithUnitField(entry, path, ctx);
      case ConfigEntryType.PIN:
        return renderPinField(entry, path, ctx);
      case ConfigEntryType.COLOR:
        return renderStringField(entry, "color", path, ctx);
      case ConfigEntryType.MAC_ADDRESS:
        return renderStringField(entry, "text", path, ctx);
      case ConfigEntryType.LAMBDA:
      case ConfigEntryType.JSON:
        return renderTextareaField(entry, path, ctx);
      case ConfigEntryType.ICON:
        return renderIconField(entry, path, ctx);
      default:
        return renderStringField(entry, "text", path, ctx);
    }
  }

  /**
   * Build the render context once per render pass. Closures over
   * `this` so callbacks see fresh element state without re-binding.
   * `renderEntry` is wired back through `ctx` so nested renderers can
   * recurse without re-entering the dispatch via the host element.
   */
  private _buildCtx(): RenderCtx {
    const ctx: RenderCtx = {
      localize: this._localize,
      disabled: this.disabled,
      yaml: this.yaml,
      fromLine: this.fromLine,
      board: this.board,
      requiredOnly: this.requiredOnly,
      nestedOpenSections: this._nestedOpenSections,
      getAt: (path) => getIn(this.values, path),
      errorAt: (path) => this.errors.get(path.join(".")) ?? null,
      emitChange: (path, value) => this._emitChange(path, value),
      toggleNested: (key) => this._toggleNested(key),
      requestAddComponent: (domain) => this._requestAddComponent(domain),
      scopeValues: (path) => this._scopeValues(path),
      filterRenderable: this._filterRenderable,
      getPendingUnit: (path) => this._pendingUnits.get(path.join(".")),
      setPendingUnit: (path, unit) => {
        this._pendingUnits.set(path.join("."), unit);
        // Trigger a re-render so the picker reflects the stash.
        // Mutating the Map alone won't, since `_pendingUnits` isn't
        // a `@state`-tracked field.
        this.requestUpdate();
      },
      getEditingMagnitude: (path) => this._editingMagnitudes.get(path.join(".")),
      setEditingMagnitude: (path, text) => {
        // No requestUpdate — the @input handler that calls this
        // also emits a value-change which re-renders us via the
        // owner's normal value-prop update. Triggering here would
        // double the work on every keystroke.
        this._editingMagnitudes.set(path.join("."), text);
      },
      clearEditingMagnitude: (path) => {
        this._editingMagnitudes.delete(path.join("."));
      },
      // Self-reference: assigned after object creation so the inner
      // renderer can recurse through the dispatch.
      renderEntry: () => nothing,
    };
    ctx.renderEntry = (entry, path) => this._renderEntry(entry, path, ctx);
    return ctx;
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private _scopeValues(path: string[]): Record<string, unknown> {
    const v = getIn(this.values, path);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  }

  private _emitChange(path: string[], value: unknown) {
    this.dispatchEvent(
      new CustomEvent<ConfigEntryValueChange>("value-change", {
        detail: { path, value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _toggleNested(key: string) {
    // The set's semantics depend on `requiredOnly` — see
    // `renderNestedField` — but the toggle is the same either way:
    // membership flips between "tracked" and "untracked".
    const next = new Set(this._nestedOpenSections);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this._nestedOpenSections = next;
  }

  /**
   * Force a nested group open. Used by parent forms (e.g. section
   * editor scrolling to a validation error) to make sure a deep field
   * is rendered before searching the DOM. Idempotent.
   *
   * Only meaningful in normal (non-requiredOnly) mode where the set
   * tracks "open" entries; in `requiredOnly` mode groups default open
   * already so this is a no-op.
   */
  public openNested(key: string) {
    if (this.requiredOnly) return;
    if (this._nestedOpenSections.has(key)) return;
    const next = new Set(this._nestedOpenSections);
    next.add(key);
    this._nestedOpenSections = next;
  }

  /**
   * Ask the host to open the add-component flow filtered to a domain.
   * The `add-component-form` re-routes this within its own dialog
   * (catalog view, search filter); the section editor's host catches
   * it at a higher level and opens the dialog from scratch.
   */
  private _requestAddComponent(domain: string) {
    this.dispatchEvent(
      new CustomEvent("request-add-component", {
        detail: { domain },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-config-entry-form": ESPHomeConfigEntryForm;
  }
}
