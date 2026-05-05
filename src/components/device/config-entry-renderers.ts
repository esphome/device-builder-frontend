/**
 * Field renderers for the ConfigEntry form. The complex pin and
 * id-reference renderers live in their own modules; this file owns
 * the simple field shapes (string/number/boolean/select/textarea/
 * icon/multi-value/nested) and re-exports the rest so the form can
 * import everything from one place.
 *
 * Every renderer is a pure function — it takes a `RenderCtx`
 * (props/values/callbacks closed over the host element) plus the
 * entry + path it's rendering, and returns Lit `html`. The form
 * splices the result into its shadow DOM.
 */

import { html, nothing } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import type { ConfigEntry } from "../../api/types.js";
import { ConfigEntryType } from "../../api/types.js";
import {
  chooseDisplayUnit,
  parseFloatWithUnit,
  placeholderForFloatWithUnit,
  serializeFloatWithUnit,
} from "../../util/float-with-unit.js";
import { isPrimitiveOrNullish } from "../../util/nested-values.js";
import {
  effectiveDisabled,
  labelFor,
  renderFieldError,
  renderHelpLink,
  renderLabel,
  renderStringField,
  type RenderCtx,
} from "./config-entry-renderers-shared.js";

export {
  effectiveDisabled,
  labelFor,
  renderLabel,
  renderStringField,
  type RenderCtx,
} from "./config-entry-renderers-shared.js";
export {
  ADD_NEW_SENTINEL,
  renderIdReferenceField,
} from "./config-entry-id-reference-renderer.js";
export { renderPinField } from "./config-entry-pin-renderer.js";

export function renderNumberField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
) {
  // A featured-entry preset can pin the choice to a short list of
  // numbers — defer to the suggestion-aware string renderer which
  // converts the picked value back to a number on change.
  if (entry.suggestions && entry.suggestions.length > 0) {
    return renderStringField(entry, "number", path, ctx);
  }
  const value = String(ctx.getAt(path) ?? "");
  const invalid = ctx.errorAt(path) !== null;
  const min = entry.range ? String(entry.range[0]) : undefined;
  const max = entry.range ? String(entry.range[1]) : undefined;
  const disabled = effectiveDisabled(entry, ctx);
  return html`
    <div class="field" data-field-key=${path.join(".")}>
      ${renderLabel(entry, ctx)}
      <input
        type="number"
        class=${invalid ? "invalid" : ""}
        .value=${value}
        ?disabled=${disabled}
        min=${min ?? ""}
        max=${max ?? ""}
        step=${entry.type === ConfigEntryType.FLOAT ? "any" : "1"}
        placeholder=${String(entry.default_value ?? "")}
        @input=${(e: Event) => {
          const raw = (e.target as HTMLInputElement).value;
          ctx.emitChange(path, raw === "" ? "" : Number(raw));
        }}
      />
      ${renderFieldError(path, ctx)}
    </div>
  `;
}

/**
 * Number input + unit picker for FLOAT_WITH_UNIT entries.
 *
 * The YAML shape is a single string `"<value><unit>"`; we render the
 * two halves as separate controls and serialize back on every change.
 * Empty number -> empty string emitted (so optional entries get
 * stripped from the payload by `_coerceFields`).
 *
 * `range` constrains the numeric part only — esphome's range bounds
 * for `cv.frequency` etc. are post-coercion floats relative to the
 * canonical unit, but the dashboard's input is the user-facing number
 * so applying them directly only matches when the picked unit equals
 * the canonical one. We omit the HTML range attributes when the unit
 * isn't canonical to avoid spurious browser-level rejection on values
 * that round-trip fine after multiplication.
 */
export function renderFloatWithUnitField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
) {
  const unitOptions = entry.unit_options ?? [];
  const canonicalUnit = unitOptions[0] ?? "";
  const rawValue = ctx.getAt(path);
  const parsed = parseFloatWithUnit(rawValue, unitOptions);
  // Prefer the in-progress edit buffer over the form value so
  // intermediate typing states (`"-"`, `"1e"`, `"1."`) aren't
  // clobbered by the dirty-check write that fires when the parser
  // turns them into `null` / `""`. The buffer is cleared on blur
  // and on `entries` change.
  const editingText = ctx.getEditingMagnitude(path);
  const numberValue =
    editingText ?? (parsed.value === null ? "" : String(parsed.value));
  const unit = chooseDisplayUnit(
    rawValue,
    entry.default_value,
    ctx.getPendingUnit(path),
    unitOptions,
  );
  const placeholder = placeholderForFloatWithUnit(
    entry.default_value,
    unitOptions,
  );
  const invalid = ctx.errorAt(path) !== null;
  const disabled = effectiveDisabled(entry, ctx);
  const isCanonical = unit === canonicalUnit;
  const min = entry.range && isCanonical ? String(entry.range[0]) : undefined;
  const max = entry.range && isCanonical ? String(entry.range[1]) : undefined;
  const emit = (next: { value: number | null; unit: string }) =>
    ctx.emitChange(path, serializeFloatWithUnit(next));
  return html`
    <div class="field float-with-unit" data-field-key=${path.join(".")}>
      ${renderLabel(entry, ctx)}
      <div class="float-with-unit-inputs">
        <input
          type="number"
          class=${invalid ? "invalid" : ""}
          .value=${numberValue}
          ?disabled=${disabled}
          min=${ifDefined(min)}
          max=${ifDefined(max)}
          step="any"
          placeholder=${placeholder}
          @input=${(e: Event) => {
            const raw = (e.target as HTMLInputElement).value;
            // Stash the raw text so an intermediate state (`"-"`,
            // `"1e"`) survives the next re-render. The buffer is
            // ignored once a blur event fires.
            ctx.setEditingMagnitude(path, raw);
            // Clearing the magnitude drops the unit from the YAML
            // value (`{null, kHz}` serializes to `""`), so stash
            // the current unit too — otherwise the next render's
            // fallback chain snaps the picker back to the catalog
            // default and the user's earlier pick is lost.
            if (raw === "") {
              ctx.setPendingUnit(path, unit);
            }
            const next = raw === "" ? null : Number(raw);
            emit({ value: Number.isFinite(next) ? next : null, unit });
          }}
          @blur=${() => ctx.clearEditingMagnitude(path)}
        />
        ${unitOptions.length > 1
          ? html`
              <wa-select
                data-no-value-sync
                ?disabled=${disabled}
                @change=${(e: Event) => {
                  const nextUnit = (e.target as HTMLSelectElement).value;
                  if (parsed.value === null) {
                    // No numeric value yet — stash the unit so the
                    // picker stays on the user's pick. Serializing
                    // ``{value:null, unit}`` would emit `""` and the
                    // next render's default-fallback would snap the
                    // picker back to canonical.
                    ctx.setPendingUnit(path, nextUnit);
                  } else {
                    emit({ value: parsed.value, unit: nextUnit });
                  }
                }}
              >
                ${unitOptions.map(
                  (option) => html`<wa-option
                    value=${option}
                    ?selected=${option === unit}
                    >${option}</wa-option
                  >`,
                )}
              </wa-select>
            `
          : html`<span class="float-with-unit-suffix">${unit}</span>`}
      </div>
      ${renderFieldError(path, ctx)}
    </div>
  `;
}

export function renderBooleanField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
) {
  const raw = ctx.getAt(path);
  const checked = raw === true || raw === "true";
  return html`
    <div class="switch-field" data-field-key=${path.join(".")}>
      <div class="field-info">
        ${renderLabel(entry, ctx, { includeHelpLink: false })}
      </div>
      ${renderHelpLink(entry, ctx)}
      <wa-switch
        ?checked=${checked}
        ?disabled=${effectiveDisabled(entry, ctx)}
        @change=${(e: Event) =>
          ctx.emitChange(
            path,
            (e.target as HTMLInputElement & { checked: boolean }).checked,
          )}
      ></wa-switch>
    </div>
  `;
}

export function renderSelectField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
) {
  const value = String(ctx.getAt(path) ?? "");
  const invalid = ctx.errorAt(path) !== null;
  const disabled = effectiveDisabled(entry, ctx);
  // A featured-entry `suggestions` list overrides the catalog `options`
  // if both are set — the board author has narrowed the choice further.
  // Always render a strict select; suggestions are a closed set, so the
  // combobox path doesn't apply.
  if (entry.suggestions && entry.suggestions.length > 0) {
    const valueLower = value.toLowerCase();
    return html`
      <div class="field" data-field-key=${path.join(".")}>
        ${renderLabel(entry, ctx)}
        <wa-select
          class=${invalid ? "invalid" : ""}
          ?disabled=${disabled}
          placeholder=${String(entry.default_value ?? "")}
          @change=${(e: Event) =>
            ctx.emitChange(path, (e.target as HTMLSelectElement).value)}
        >
          ${entry.suggestions.map((s) => {
            const v = String(s);
            return html`<wa-option
              value=${v}
              ?selected=${v.toLowerCase() === valueLower}
              >${v}</wa-option
            >`;
          })}
        </wa-select>
        ${renderFieldError(path, ctx)}
      </div>
    `;
  }
  if (entry.allow_custom_value && entry.options && entry.options.length > 0) {
    const listId = `combobox-${path.join("-")}`;
    return html`
      <div class="field" data-field-key=${path.join(".")}>
        ${renderLabel(entry, ctx)}
        <input
          type="text"
          class="combobox-input ${invalid ? "invalid" : ""}"
          list=${listId}
          .value=${value}
          ?disabled=${disabled}
          placeholder=${String(entry.default_value ?? "")}
          @input=${(e: Event) =>
            ctx.emitChange(path, (e.target as HTMLInputElement).value)}
        />
        <datalist id=${listId}>
          ${entry.options.map(
            (opt) => html`<option value=${opt.value}>${opt.label}</option>`,
          )}
        </datalist>
        ${renderFieldError(path, ctx)}
      </div>
    `;
  }
  // Catalog option values are sometimes stored in a different case
  // than the actual YAML uses (e.g. options return `ESP32C6` but
  // ESPHome configs use `esp32c6`). Compare case-insensitively so the
  // matching option still flags as selected — without a match the
  // dropdown would render blank even though the YAML value is valid.
  const valueLower = value.toLowerCase();
  // Surface the entry's default value as the wa-select placeholder
  // when nothing is picked yet — same pattern the string/number
  // fields already use. Resolve to the matching option's friendly
  // label when possible (so e.g. an option `{label: "Debug", value:
  // "DEBUG"}` reads as "Debug" rather than "DEBUG"), and fall back
  // to the raw default string otherwise.
  const defaultStr =
    entry.default_value != null ? String(entry.default_value) : "";
  const defaultOption = entry.options?.find(
    (o) => o.value.toLowerCase() === defaultStr.toLowerCase(),
  );
  const placeholder = defaultOption?.label ?? defaultStr;
  return html`
    <div class="field" data-field-key=${path.join(".")}>
      ${renderLabel(entry, ctx)}
      <wa-select
        class=${invalid ? "invalid" : ""}
        ?disabled=${disabled}
        placeholder=${placeholder}
        @change=${(e: Event) =>
          ctx.emitChange(path, (e.target as HTMLSelectElement).value)}
      >
        ${(entry.options ?? []).map(
          (opt) =>
            html`<wa-option
              value=${opt.value}
              ?selected=${opt.value.toLowerCase() === valueLower}
              >${opt.label}</wa-option
            >`,
        )}
      </wa-select>
      ${renderFieldError(path, ctx)}
    </div>
  `;
}

export function renderTextareaField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
) {
  const value = String(ctx.getAt(path) ?? "");
  const invalid = ctx.errorAt(path) !== null;
  return html`
    <div class="field" data-field-key=${path.join(".")}>
      ${renderLabel(entry, ctx)}
      <textarea
        class="textarea-field ${invalid ? "invalid" : ""}"
        rows="4"
        ?disabled=${effectiveDisabled(entry, ctx)}
        .value=${value}
        placeholder=${String(entry.default_value ?? "")}
        @input=${(e: Event) =>
          ctx.emitChange(path, (e.target as HTMLTextAreaElement).value)}
      ></textarea>
      ${renderFieldError(path, ctx)}
    </div>
  `;
}

export function renderIconField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
) {
  const value = String(ctx.getAt(path) ?? "");
  const invalid = ctx.errorAt(path) !== null;
  return html`
    <div class="field" data-field-key=${path.join(".")}>
      ${renderLabel(entry, ctx)}
      <esphome-mdi-icon-picker
        .value=${value}
        .invalid=${invalid}
        .disabled=${effectiveDisabled(entry, ctx)}
        .placeholder=${String(entry.default_value ?? "Choose an icon…")}
        @change=${(e: CustomEvent<{ value: string }>) =>
          ctx.emitChange(path, e.detail.value)}
      ></esphome-mdi-icon-picker>
      ${renderFieldError(path, ctx)}
    </div>
  `;
}

export function renderMultiValueField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
) {
  const raw = ctx.getAt(path);
  const items: string[] = Array.isArray(raw) ? raw.map((v) => String(v)) : [];
  const invalid = ctx.errorAt(path) !== null;
  const disabled = effectiveDisabled(entry, ctx);

  const updateAt = (idx: number, value: string) => {
    const cur = ctx.getAt(path);
    const current = Array.isArray(cur) ? [...cur] : [];
    current[idx] = value;
    ctx.emitChange(path, current);
  };
  const removeAt = (idx: number) => {
    const cur = ctx.getAt(path);
    const current = Array.isArray(cur) ? cur : [];
    ctx.emitChange(
      path,
      current.filter((_, i) => i !== idx),
    );
  };
  const addItem = () => {
    const cur = ctx.getAt(path);
    const current = Array.isArray(cur) ? cur : [];
    ctx.emitChange(path, [...current, ""]);
  };

  return html`
    <div class="field" data-field-key=${path.join(".")}>
      ${renderLabel(entry, ctx)}
      ${items.length === 0
        ? html`<p class="field-description">
            ${ctx.localize("device.multi_value_empty")}
          </p>`
        : nothing}
      ${items.map(
        (item, i) => html`
          <div class="multi-row">
            <input
              type="text"
              class="multi-input ${invalid ? "invalid" : ""}"
              .value=${item}
              ?disabled=${disabled}
              @input=${(e: Event) =>
                updateAt(i, (e.target as HTMLInputElement).value)}
            />
            <button
              type="button"
              class="multi-btn"
              ?disabled=${disabled}
              aria-label=${ctx.localize("device.multi_value_remove")}
              @click=${() => removeAt(i)}
            >
              <wa-icon library="mdi" name="close"></wa-icon>
            </button>
          </div>
        `,
      )}
      <button
        type="button"
        class="multi-btn multi-add"
        ?disabled=${disabled}
        @click=${addItem}
      >
        <wa-icon library="mdi" name="plus"></wa-icon>
        ${ctx.localize("device.multi_value_add")}
      </button>
      ${renderFieldError(path, ctx)}
    </div>
  `;
}

/**
 * Render a free-form map field. The user types each key (e.g. a
 * component domain like `sensor`, a substitution name, etc.) and
 * picks a value matching the template defined by
 * `entry.config_entries[0]`. Used for `logger.logs:`,
 * `substitutions:`, `globals:`, `api.actions:`, ... — schemas where
 * enumerating every possible key on the backend would explode the
 * config tree.
 *
 * Storage: `values[mapKey] = { userKey: userValue, ... }` — a plain
 * object preserving insertion order. Renames rebuild the object so
 * the row stays in place; deletes remove the entry. Adds inject a
 * placeholder key (`new_1`, `new_2`, ...) the user is expected to
 * rename.
 */
export function renderMapField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
) {
  const valueTemplate = (entry.config_entries ?? [])[0];
  const raw = ctx.getAt(path);
  const map: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const keys = Object.keys(map);
  const disabled = effectiveDisabled(entry, ctx);

  // Mutations preserve the source dict's null-prototype shape.
  // ``parseYamlSectionValues`` builds top-level values via
  // ``Object.create(null)`` so a YAML key like ``__proto__`` /
  // ``constructor`` lands as own property data instead of
  // mutating ``Object.prototype``. A naive ``{...obj}`` spread
  // would silently swap that for a regular prototype-bearing
  // object on the first add / rename / delete and re-open the
  // prototype-pollution surface. Always copy via
  // ``Object.assign(Object.create(null), …)`` so the protection
  // survives every mutation. (Copilot-flagged.)
  const cloneMap = (
    src: Record<string, unknown>,
  ): Record<string, unknown> => Object.assign(Object.create(null), src);

  const readMap = (): Record<string, unknown> => {
    const cur = ctx.getAt(path);
    return cur && typeof cur === "object" && !Array.isArray(cur)
      ? cloneMap(cur as Record<string, unknown>)
      : Object.create(null);
  };

  const addEntry = () => {
    const m = readMap();
    let n = 1;
    while (`new_${n}` in m) n++;
    m[`new_${n}`] = "";
    ctx.emitChange(path, m);
  };

  const removeEntry = (key: string) => {
    const m = readMap();
    if (!(key in m)) return;
    delete m[key];
    ctx.emitChange(path, m);
  };

  // Rename preserves insertion order; refuses if the new key already
  // exists (would silently merge two rows) or is empty (round-trips
  // badly through YAML).
  const renameKey = (oldKey: string, newKey: string) => {
    if (oldKey === newKey || !newKey) return;
    const cur = ctx.getAt(path);
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return;
    const m = cur as Record<string, unknown>;
    if (newKey in m) return;
    const next: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(m)) {
      next[k === oldKey ? newKey : k] = v;
    }
    ctx.emitChange(path, next);
  };

  // The key is a free-form text input bound on `change` (commit on
  // blur — committing on every keystroke would re-key the row
  // mid-edit and steal focus). The value renders via the template
  // entry through the standard dispatch, so it picks up the right
  // control type. The value template's label is suppressed inside
  // rows by the .map-row CSS.
  // Lists / dicts (substitutions can carry arbitrary YAML —
  // verified against ESPHome's
  // ``CONFIG_SCHEMA = cv.Schema({validate_substitution_key: object})``)
  // would render as ``[object Object]`` through the string-shaped
  // value template and lose data on save. Detect non-primitive
  // values per-row and surface a "edit in YAML" placeholder
  // instead — the row is preserved (key still renames / deletes),
  // only the value cell is structurally non-editable here.
  const renderRow = (rowKey: string) => {
    const valuePath = [...path, rowKey];
    const complex = !isPrimitiveOrNullish(map[rowKey]);
    return html`
      <div class="map-row">
        <input
          type="text"
          class="multi-input map-key-input"
          .value=${rowKey}
          ?disabled=${disabled}
          @change=${(e: Event) =>
            renameKey(rowKey, (e.target as HTMLInputElement).value)}
        />
        <div class="map-value">
          ${complex
            ? html`<p class="map-value-yaml-only">
                ${ctx.localize("device.map_value_edit_in_yaml")}
              </p>`
            : valueTemplate
              ? ctx.renderEntry(valueTemplate, valuePath)
              : nothing}
        </div>
        <button
          type="button"
          class="multi-btn"
          ?disabled=${disabled}
          aria-label=${ctx.localize("device.map_remove")}
          @click=${() => removeEntry(rowKey)}
        >
          <wa-icon library="mdi" name="close"></wa-icon>
        </button>
      </div>
    `;
  };

  return html`
    <div class="field" data-field-key=${path.join(".")}>
      ${renderLabel(entry, ctx)}
      ${keys.length === 0
        ? html`<p class="field-description">
            ${ctx.localize("device.map_empty")}
          </p>`
        : nothing}
      ${keys.map((k) => renderRow(k))}
      <button
        type="button"
        class="multi-btn multi-add"
        ?disabled=${disabled}
        @click=${addEntry}
      >
        <wa-icon library="mdi" name="plus"></wa-icon>
        ${ctx.localize("device.map_add")}
      </button>
      ${renderFieldError(path, ctx)}
    </div>
  `;
}

export function renderNestedField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
) {
  const key = path.join(".");
  // In `requiredOnly` mode (the add-component dialog) groups default
  // open so the user sees the required fields immediately, and the set
  // tracks groups they've explicitly *collapsed*. In normal mode
  // groups default closed and the set tracks groups they've explicitly
  // *opened*.
  const inSet = ctx.nestedOpenSections.has(key);
  const isOpen = ctx.requiredOnly ? !inSet : inSet;
  const renderableChildren = ctx.filterRenderable(
    entry.config_entries ?? [],
    ctx.scopeValues(path),
  );
  return html`
    <div class="nested-group" data-field-key=${path.join(".")}>
      <button
        type="button"
        class="nested-toggle"
        @click=${() => ctx.toggleNested(key)}
      >
        <wa-icon
          library="mdi"
          name=${isOpen ? "chevron-up" : "chevron-down"}
        ></wa-icon>
        <span class="nested-title">${labelFor(entry, ctx)}</span>
        ${entry.platform_type
          ? html`<span class="nested-platform">${entry.platform_type}</span>`
          : nothing}
      </button>
      ${isOpen
        ? html`<div class="nested-fields">
            ${renderableChildren.map((child) =>
              ctx.renderEntry(child, [...path, child.key]),
            )}
          </div>`
        : nothing}
    </div>
  `;
}
