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
  isEntryVisible,
  type ValidationError,
} from "../../util/config-validation.js";
import { getIn } from "../../util/nested-values.js";
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

/**
 * Entry keys that the form keeps visible even when `requiredOnly` is
 * on. `name` becomes the entity's friendly name in Home Assistant, so
 * even though most schemas mark it optional we want to ask for it
 * up-front when the user is creating something — fewer trips back to
 * the section editor for a label they always want.
 */
export const ALWAYS_SHOWN_KEYS: ReadonlySet<string> = new Set(["name"]);

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

  static styles = [espHomeStyles, inputStyles, configEntryFormStyles];

  /**
   * Filter `entries` for rendering: hidden + dependency-failing entries
   * always go away; advanced entries go away unless `showAdvanced` is
   * on; in `requiredOnly` mode, non-required leaves go away too. NESTED
   * entries stay only if anything inside them is renderable, so an
   * empty header never sits in the form.
   */
  private _filterRenderable = (
    entries: ConfigEntry[],
    values: Record<string, unknown>,
  ): ConfigEntry[] => {
    const out: ConfigEntry[] = [];
    for (const entry of entries) {
      if (!isEntryVisible(entry, values, this.presentComponents)) continue;
      if (entry.advanced && !this.showAdvanced) continue;
      if (entry.type === ConfigEntryType.NESTED) {
        const childList = entry.config_entries ?? [];
        const childValues = this._scopeValues([entry.key]);
        const renderableChildren = this._filterRenderable(childList, childValues);
        if (renderableChildren.length === 0) continue;
      } else if (
        this.requiredOnly &&
        !entry.required &&
        !ALWAYS_SHOWN_KEYS.has(entry.key)
      ) {
        // In required-only mode, drop optional leaves outright unless
        // they're on the always-shown allowlist (e.g. `name`, which is
        // optional but worth asking up-front for sensors/switches/lights).
        continue;
      }
      out.push(entry);
    }
    return out;
  };

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
      const raw = String(getIn(this.values, path) ?? "");
      // wa-select filters its `value` against the exact string of an
      // option's `value`; case mismatches between YAML and catalog
      // would silently drop the value. Look up the matching option
      // case-insensitively and feed wa-select the option's verbatim
      // value so the lookup succeeds.
      const options = Array.from(
        select.querySelectorAll<HTMLElement & { value: string }>("wa-option"),
      );
      const matched = raw
        ? options.find((o) => o.value?.toLowerCase() === raw.toLowerCase())
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
