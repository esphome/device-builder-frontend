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
import memoizeOne from "memoize-one";
import type { ESPHomeAPI } from "../../api/esphome-api.js";
import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { ConfigEntry } from "../../api/types/config-entries.js";
import { ConfigEntryType } from "../../api/types/config-entries.js";
import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, devicesContext, localizeContext } from "../../context/index.js";
import {
  parseCatalogId,
  type ComponentProvider,
} from "../../util/config-entry-yaml-scan.js";
import { type ValidationError } from "../../util/config-validation.js";
import { resolveDeviceName } from "../../util/device-name.js";
import { getErrorMessage } from "../../util/error-message.js";
import { getIn, isPrimitiveOrNullish } from "../../util/nested-values.js";
import {
  fetchPinRegistryModes,
  getCachedPinRegistryModes,
  subscribePinRegistryModes,
} from "../../util/pin-registry-modes-cache.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { SessionBlobCacheController } from "../../util/session-blob-cache-controller.js";
import { looksLikeSubstitution, parseSubstitutions } from "../../util/substitutions.js";
import {
  _isStructuralType,
  filterRenderable,
  renderFilterOptions,
} from "./config-entry-render-filter.js";
import {
  fieldKeyAttr,
  parseFieldKey,
  renderYamlOnlyField,
} from "./config-entry-renderers-shared.js";
import { FieldFocusController } from "./field-focus-controller.js";
import { FieldScrollController } from "./field-scroll-controller.js";

import "@home-assistant/webawesome/dist/components/divider/divider.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";
import "@home-assistant/webawesome/dist/components/switch/switch.js";
import "../mdi-icon-picker.js";
import "../options-combobox.js";
import {
  fieldRendererStyles,
  labelFor,
  orderExclusiveGroups,
  renderBooleanField,
  renderExclusiveGroupField,
  renderFloatWithUnitField,
  renderIconField,
  renderIdReferenceField,
  renderMapField,
  renderMultiValueField,
  renderNestedField,
  renderNestedListField,
  renderNumberField,
  renderPinField,
  renderRegistryListField,
  renderSelectField,
  renderStringField,
  renderTextareaField,
  renderTimePeriodField,
  type RenderCtx,
} from "./config-entry-renderers.js";
import { renderLambdaField } from "./config-entry-renderers/lambda.js";
import { renderTemplatableField } from "./config-entry-renderers/templatable.js";
import "./password-input.js";
import "./secret-picker.js";

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

  /** WS client — used only to fetch the session-cached pin-registry-modes
   *  map; ``subscribe`` so a late-arriving context kicks the fetch. */
  @consume({ context: apiContext, subscribe: true })
  @state()
  private _api?: ESPHomeAPI;

  /** Configured devices — resolves this device's backend node name (the
   *  hostname for per-device secret keys) from ``configuration``. */
  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  // Repaints the form (scoping the pin Mode checkboxes) once the shared
  // pin-registry-modes map arrives, and kicks the fetch when the api lands.
  private _pinRegistryModes = new SessionBlobCacheController<Record<string, string[]>>(
    this,
    {
      getCached: getCachedPinRegistryModes,
      subscribe: subscribePinRegistryModes,
      fetch: fetchPinRegistryModes,
    },
    () => this._api
  );

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

  /** Section key being edited (``light.esp32_rmt_led_strip`` /
   *  ``sensor.template`` / etc.). Threaded through ``ctx`` so
   *  ``REGISTRY_LIST`` renderers can scope their per-row picker
   *  against the parent component's domain — without it a
   *  binary_sensor's filter picker offers sensor-only filters
   *  and a non-addressable light's effects picker offers
   *  addressable-only effects. Empty when the form is mounted
   *  outside a section context (the add-component dialog's
   *  preview, etc.). */
  @property({ attribute: "section-key" })
  sectionKey = "";

  /** Device configuration id being edited; used to resolve the device's
   *  backend node name for per-device secret keys. Empty outside a device
   *  context (the add-component preview). */
  @property()
  configuration = "";

  /** Top-level component keys present in the YAML — drives the
   *  `depends_on_component` visibility predicate. */
  @property({ attribute: false })
  presentComponents: Set<string> = new Set();

  /** Instance-relative field path to scroll into view, from the YAML cursor. */
  @property({ attribute: false })
  focusFieldPath?: string[];

  @state()
  private _nestedOpenSections: Set<string> = new Set();

  /** Keys already default-opened by ``_seedNestedOpen`` so the seed fires
   *  once and a later user collapse isn't re-overridden. */
  private _seededNestedOpen: Set<string> = new Set();

  /** Resolved providers per interface name, and the in-flight set, for the
   *  id-reference dropdown's cross-domain lookup. */
  private _interfaceProviders: Map<string, ComponentProvider[]> = new Map();
  private _interfaceProvidersPending: Set<string> = new Set();

  /** Scrolls the YAML-cursor-selected field into view (the structured side
   *  of the field sync); driven from ``updated``. */
  private _fieldScroll = new FieldScrollController(this);

  /** Emits ``field-focus`` as the user moves between fields (the other side
   *  of the sync); owns its own listener lifecycle. */
  private _fieldFocus = new FieldFocusController(this);

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

  static styles = fieldRendererStyles;

  /**
   * Filter `entries` for rendering. Delegates to the shared
   * ``filterRenderable`` helper so the add-component form's
   * "is this error visible?" check (which mirrors the same rules)
   * can never drift from what's actually painted.
   */
  private _filterRenderable = (
    entries: ConfigEntry[],
    values: Record<string, unknown>
  ): ConfigEntry[] => filterRenderable(entries, values, renderFilterOptions(this));

  protected render() {
    const ctx = this._buildCtx();
    // In the add-component dialog, float required entries above optional
    // ones (stable, so each keeps its catalog order) so the user fills the
    // mandatory fields first. The section editor mirrors the on-disk YAML
    // order, so it's left untouched.
    const entries = this.requiredOnly
      ? this._floatRequiredFirst(this.entries)
      : this.entries;
    // Each exclusive_group renders as one always-shown dropdown at its
    // first member's slot; other entries keep the advanced/visibility
    // filter (the Set preserves order while dropping filtered-out ones).
    const ordered = orderExclusiveGroups(entries);
    const nonExclusive = entries.filter((entry) => !entry.exclusive_group);
    const visible = new Set(this._filterRenderable(nonExclusive, this.values));
    // An empty key means "this entry IS the whole values dict" —
    // used by top-level user-keyed sections (substitutions:) where
    // the component itself is the map. Pass ``[]`` so the entry's
    // renderer sees the values dict directly via ``ctx.getAt([])``.
    return html`${ordered.map((item) =>
      Array.isArray(item)
        ? renderExclusiveGroupField(item, ctx)
        : visible.has(item)
          ? this._renderEntry(item, item.key ? [item.key] : [], ctx)
          : nothing
    )}`;
  }

  /** Stable-partition so required entries lead. An exclusive_group is
   *  treated atomically (required if any member is) so its members stay
   *  contiguous and ``orderExclusiveGroups`` folds them at the same slot. */
  private _floatRequiredFirst(entries: ConfigEntry[]): ConfigEntry[] {
    const groupRequired = new Map<string, boolean>();
    for (const e of entries) {
      if (e.exclusive_group) {
        groupRequired.set(
          e.exclusive_group,
          (groupRequired.get(e.exclusive_group) ?? false) || !!e.required
        );
      }
    }
    const isRequired = (e: ConfigEntry): boolean =>
      e.exclusive_group ? groupRequired.get(e.exclusive_group)! : !!e.required;
    return [...entries.filter(isRequired), ...entries.filter((e) => !isRequired(e))];
  }

  protected willUpdate(changed: PropertyValues) {
    // A different entry list means the form was re-targeted to a
    // different component (e.g. the dep-flow detour swapping
    // ES7210 for i2c). Drop transient unit picks from the previous
    // shape so they don't bleed into unrelated paths.
    if (changed.has("entries") && changed.get("entries") !== undefined) {
      this._pendingUnits.clear();
      this._editingMagnitudes.clear();
      // Re-seed disclosures for the new component; a key like "pin:pin-advanced"
      // recurs across sections, and the form instance is reused.
      this._seededNestedOpen.clear();
    }
  }

  /** Decode a field element's ``data-field-key`` to its path. */
  private _pathOf(el: Element): string[] {
    return parseFieldKey(el.getAttribute("data-field-key") ?? "");
  }

  protected updated(changed: PropertyValues) {
    super.updated(changed);
    void this._syncSelectValues();
    this._fieldScroll.maybeScroll(changed);
  }

  /**
   * After every render, push the current value onto each <wa-select>
   * imperatively. This is a workaround for a wa-select quirk where
   * the value/selected wiring through Lit's template doesn't always
   * land — especially on the first paint, when wa-select reads its
   * value before the slotted options are connected. Each field div
   * carries a `data-field-key` (the JSON-encoded path) so we can look
   * up the right value for its select. Encoding the path as JSON
   * rather than a dotted string keeps user-supplied map keys that
   * contain a dot (a `logger.logs` row keyed `i2c.idf`) intact.
   *
   * We wait for each select's `updateComplete` (and one frame after
   * that) to make sure wa-select's own first-render bookkeeping —
   * `handleDefaultSlotChange`, `setSelectedOptions`, etc. — has run
   * before we set `.value`. Otherwise our imperative set fights with
   * wa-select's own initial value resolution and the displayed label
   * stays blank.
   */
  private async _syncSelectValues() {
    if (!this.shadowRoot) return;
    const fields = this.shadowRoot.querySelectorAll<HTMLElement>("[data-field-key]");
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
      const path = this._pathOf(field);
      if (!path.length) continue;
      const value = getIn(this.values, path);
      // ``wa-select`` only carries primitive values; if the YAML
      // path resolves to an object (transient state from a partial
      // edit — e.g. autocompletion just inserted ``then:\n  - ``
      // and js-yaml produced an empty mapping at this position),
      // ``String(value)`` can throw "Cannot convert object to
      // primitive value" for null-prototype objects. Clear any
      // stale selection rather than leaving the previous primitive
      // displayed against a now-non-primitive YAML state.
      // Renderers whose value can legitimately be a non-primitive
      // (PIN's long-form block, FLOAT_WITH_UNIT's unit picker)
      // opt out of this generic sync via ``data-no-value-sync``
      // — handled above — and own their selection through
      // ``_syncSelectedAttr`` against the ``?selected`` Lit
      // binding instead.
      if (!isPrimitiveOrNullish(value)) {
        const current = Array.isArray(select.value)
          ? (select.value[0] ?? "")
          : (select.value ?? "");
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
        select.querySelectorAll<HTMLElement & { value: string }>("wa-option")
      );
      const rawGpio = raw.match(/^\s*(?:GPIO)?(\d+)\s*$/i)?.[1];
      const findByValue = (v: string) =>
        options.find((o) => o.value?.toLowerCase() === v.toLowerCase());
      const matched = raw
        ? (findByValue(raw) ?? (rawGpio ? findByValue(`GPIO${rawGpio}`) : undefined))
        : null;
      const desired = matched?.value ?? raw;
      const current = Array.isArray(select.value)
        ? (select.value[0] ?? "")
        : (select.value ?? "");
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
    }
  ) {
    if (select.updateComplete) {
      try {
        await select.updateComplete;
      } catch {
        // ignore
      }
    }
    const selectedOption = select.querySelector<HTMLElement & { value: string }>(
      "wa-option[selected]"
    );
    const desired = selectedOption?.value ?? "";
    if (!desired) return;
    const current = Array.isArray(select.value)
      ? (select.value[0] ?? "")
      : (select.value ?? "");
    if (current !== desired) {
      select.value = desired;
    }
  }

  // ─── Entry dispatch ─────────────────────────────────────────────

  private _renderEntry(entry: ConfigEntry, path: string[], ctx: RenderCtx) {
    try {
      return this._renderEntryUnsafe(entry, path, ctx);
    } catch (err) {
      // Surface render failures in the UI rather than swallowing
      // them into a blank section. Without this, a renderer that
      // throws (or silently returns ``nothing`` because the entry
      // shape is wrong) leaves the user staring at empty space —
      // the visible form looks correct, the data appears gone,
      // and the only signal is in the dev console.
      // eslint-disable-next-line no-console
      console.error(
        "esphome-config-entry-form: render failed for entry",
        { key: entry.key, type: entry.type, path },
        err
      );
      const message = getErrorMessage(err);
      return html`<div class="render-error" role="alert">
        <wa-icon library="mdi" name="alert-circle-outline"></wa-icon>
        <div>
          <strong> ${this._localize("device.entry_render_error_title")} </strong>
          <code class="render-error-key"
            >${entry.key || "(empty key)"} · ${entry.type}</code
          >
          <pre class="render-error-message">${message}</pre>
        </div>
      </div>`;
    }
  }

  private _renderEntryUnsafe(
    entry: ConfigEntry,
    path: string[],
    ctx: RenderCtx
  ): unknown {
    // Templatable wrapper pre-empts the type switch for any leaf
    // entry that accepts a literal-or-lambda value. Structural
    // types (NESTED / MAP / DIVIDER / LABEL / ALERT) opt out — a
    // toggle on a group or annotation isn't a coherent control.
    // The wrapper recurses by calling the inner renderer through
    // a thunk so we don't need to duplicate the type switch here.
    if (entry.templatable && !_isStructuralType(entry.type)) {
      return renderTemplatableField(entry, path, ctx, () =>
        this._renderEntryLeaf(entry, path, ctx)
      );
    }
    return this._renderEntryLeaf(entry, path, ctx);
  }

  private _renderEntryLeaf(entry: ConfigEntry, path: string[], ctx: RenderCtx): unknown {
    // A ${var} value can't drive a typed widget (number/select/switch): it
    // blanks the literal and the first interaction clobbers it. Edit it as
    // text so the token round-trips and stays editable mid-keystroke;
    // SECURE_STRING stays masked (#1391).
    const raw = ctx.getAt(path);
    if (typeof raw === "string" && looksLikeSubstitution(raw)) {
      const inputType =
        entry.type === ConfigEntryType.SECURE_STRING ? "password" : "text";
      return renderStringField(entry, inputType, path, ctx);
    }
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
      // Repeatable nested mapping (``esphome.devices``,
      // ``esphome.areas``, …). The single-group renderer can't
      // express the list shape, so route to the list renderer first.
      if (entry.multi_value) {
        return renderNestedListField(entry, path, ctx);
      }
      return renderNestedField(entry, path, ctx);
    }
    if (entry.type === ConfigEntryType.MAP) {
      return renderMapField(entry, path, ctx);
    }
    if (entry.type === ConfigEntryType.REGISTRY_LIST) {
      return renderRegistryListField(entry, path, ctx);
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
      case ConfigEntryType.TIME_PERIOD:
        return renderTimePeriodField(entry, path, ctx);
      case ConfigEntryType.PIN:
        return renderPinField(entry, path, ctx);
      case ConfigEntryType.COLOR:
        return renderStringField(entry, "color", path, ctx);
      case ConfigEntryType.MAC_ADDRESS:
        return renderStringField(entry, "text", path, ctx);
      case ConfigEntryType.LAMBDA:
        return renderLambdaField(entry, path, ctx);
      case ConfigEntryType.JSON:
        return renderTextareaField(entry, path, ctx);
      case ConfigEntryType.ICON:
        return renderIconField(entry, path, ctx);
      case ConfigEntryType.TRIGGER:
        // A component action-list config field (cover ``open_action`` …):
        // a bare action list edited in the automation editor, not inline.
        // The form knows only the field key, so emit ``edit-action-field``
        // and let the section host resolve the component instance and
        // route to the automation editor.
        return html`<div class="field" data-field-key=${fieldKeyAttr(path)}>
          ${labelFor(entry, ctx)}
          <button
            type="button"
            class="edit-actions-button"
            ?disabled=${ctx.disabled}
            @click=${() => this._emitEditActionField(entry.key)}
          >
            ${ctx.localize("device.automation_action_field_edit")}
          </button>
        </div>`;
      case ConfigEntryType.UNKNOWN:
        // A mapping-or-list union the backend can't model; the YAML pane
        // holds it where a single input can't.
        return renderYamlOnlyField(entry, path, ctx);
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
  /** Memoised on the YAML so the substitution parse runs once per edit,
   *  not once per render or per referencing field. */
  private _parseSubstitutions = memoizeOne(parseSubstitutions);

  private _buildCtx(): RenderCtx {
    const ctx: RenderCtx = {
      localize: this._localize,
      disabled: this.disabled,
      yaml: this.yaml,
      substitutions: this._parseSubstitutions(this.yaml),
      fromLine: this.fromLine,
      sectionKey: this.sectionKey,
      deviceName: resolveDeviceName(this._devices, this.configuration),
      board: this.board,
      pinRegistryModes: this._pinRegistryModes.value,
      requiredOnly: this.requiredOnly,
      showAdvanced: this.showAdvanced,
      presentComponents: this.presentComponents,
      nestedOpenSections: this._nestedOpenSections,
      getAt: (path) => getIn(this.values, path),
      errorAt: (path) => this.errors.get(path.join(".")) ?? null,
      emitChange: (path, value) => this._emitChange(path, value),
      toggleNested: (key) => this._toggleNested(key),
      seedNestedOpen: (key) => this._seedNestedOpen(key),
      requestAddComponent: (domain) => this._requestAddComponent(domain),
      resolveInterfaceProviders: (interfaceName) =>
        this._resolveInterfaceProviders(interfaceName),
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
      // Stable object identity for renderer-local WeakMap stashes
      // (templatable literal/lambda recovery, currently). The host
      // element survives the per-render ctx rebuild so it's the
      // right key to hang cross-render scratch state on.
      stashOwner: this,
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
      })
    );
  }

  /** A TRIGGER (action-list) field's "Edit actions" was clicked. The
   *  host resolves the component instance and routes to the automation
   *  editor — the form only knows the field key. */
  private _emitEditActionField(field: string) {
    this.dispatchEvent(
      new CustomEvent<{ field: string }>("edit-action-field", {
        detail: { field },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _toggleNested(key: string) {
    // The set tracks open groups; flip membership to expand/collapse.
    const next = new Set(this._nestedOpenSections);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this._nestedOpenSections = next;
  }

  /**
   * Force a nested group open. Used by parent forms (e.g. section
   * editor scrolling to a validation error) to make sure a deep field
   * is rendered before searching the DOM. Idempotent.
   */
  public openNested(key: string) {
    if (this._nestedOpenSections.has(key)) return;
    const next = new Set(this._nestedOpenSections);
    next.add(key);
    this._nestedOpenSections = next;
  }

  /**
   * Open *key* once as a default (honoring a later user collapse). Mutates
   * in place so seeding mid-render schedules no update; the seeded marker
   * keeps it to one shot.
   */
  private _seedNestedOpen(key: string) {
    if (this._seededNestedOpen.has(key)) return;
    this._seededNestedOpen.add(key);
    this._nestedOpenSections.add(key);
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
      })
    );
  }

  /**
   * Providers of an interface reference, from a per-form cache.
   *
   * A miss fetches the catalog by ``provides`` once and re-renders on
   * resolve; an empty *success* caches ``[]`` (a same-domain reference has
   * no extra providers). A *failure* is logged and left uncached so a later
   * render retries rather than permanently dropping candidates.
   */
  private _resolveInterfaceProviders(
    interfaceName: string
  ): readonly ComponentProvider[] {
    if (!interfaceName) return [];
    const cached = this._interfaceProviders.get(interfaceName);
    if (cached) return cached;
    if (this._api && !this._interfaceProvidersPending.has(interfaceName)) {
      this._interfaceProvidersPending.add(interfaceName);
      // ``limit: 200`` captures every provider of the interface in one shot
      // (interfaces have at most a couple dozen); this is the full dropdown
      // candidate set, distinct from the Add-component picker's paginated grid.
      this._api
        .getComponents({ provides: interfaceName, limit: 200 })
        .then((resp) => {
          this._interfaceProviders.set(
            interfaceName,
            resp.components.map((c) => parseCatalogId(c.id))
          );
          this.requestUpdate();
        })
        .catch((err) =>
          // Warn (not debug) so the dropped-candidate path is observable, and
          // don't cache [] — that's indistinguishable from "no providers" and
          // would silently omit candidates for the form's lifetime.
          console.warn(
            "[config-entry-form] provider fetch failed for",
            interfaceName,
            err
          )
        )
        .finally(() => this._interfaceProvidersPending.delete(interfaceName));
    }
    return [];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-config-entry-form": ESPHomeConfigEntryForm;
  }
}
