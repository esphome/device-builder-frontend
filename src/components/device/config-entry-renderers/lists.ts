import { html, nothing } from "lit";
import { isLambdaValue } from "../../../api/types/automations.js";
import type { ConfigEntry } from "../../../api/types/config-entries.js";
import { ConfigEntryType } from "../../../api/types/config-entries.js";
import { asMappingList, isPrimitiveOrNullish } from "../../../util/nested-values.js";
import { escapeForInput, unescapeForInput } from "../../../util/yaml-escape.js";
import { YamlRawValue } from "../../../util/yaml-serialize.js";
import {
  effectiveDisabled,
  fieldKeyAttr,
  labelFor,
  renderFieldError,
  renderLabel,
  renderYamlOnlyField,
  type RenderCtx,
} from "../config-entry-renderers-shared.js";

// Returns an empty array (not undefined) when nothing's there or the value
// isn't an array — list mutations always round-trip through this so the new
// array is a clean copy of a known-array shape.
function readArrayAt(ctx: RenderCtx, path: string[]): readonly unknown[] {
  const cur = ctx.getAt(path);
  return Array.isArray(cur) ? cur : [];
}

// Shared add/remove closures for both list renderers. Caller passes the
// new-item factory ("" for scalars, {} for nested mappings).
function arrayItemHandlers(
  ctx: RenderCtx,
  path: string[],
  makeNewItem: () => unknown
): { addItem: () => void; removeAt: (idx: number) => void } {
  const removeAt = (idx: number) =>
    ctx.emitChange(
      path,
      readArrayAt(ctx, path).filter((_, i) => i !== idx)
    );
  const addItem = () => ctx.emitChange(path, [...readArrayAt(ctx, path), makeNewItem()]);
  return { addItem, removeAt };
}

export function renderListEmptyHint(items: readonly unknown[], ctx: RenderCtx) {
  return items.length === 0
    ? html`<p class="field-description">${ctx.localize("device.multi_value_empty")}</p>`
    : nothing;
}

export function renderListRemoveButton(
  ctx: RenderCtx,
  disabled: boolean,
  onClick: () => void
) {
  return html`
    <button
      type="button"
      class="multi-btn"
      ?disabled=${disabled}
      aria-label=${ctx.localize("device.multi_value_remove")}
      @click=${onClick}
    >
      <wa-icon library="mdi" name="close"></wa-icon>
    </button>
  `;
}

export function renderListAddButton(
  ctx: RenderCtx,
  disabled: boolean,
  onClick: () => void
) {
  return html`
    <button
      type="button"
      class="multi-btn multi-add"
      ?disabled=${disabled}
      @click=${onClick}
    >
      <wa-icon library="mdi" name="plus"></wa-icon>
      ${ctx.localize("device.multi_value_add")}
    </button>
  `;
}

export function renderMultiValueField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx
) {
  const raw = readArrayAt(ctx, path);
  // A list whose items are mappings (a backend list-of-dicts the schema
  // bundle couldn't type as nested, e.g. a light's ``segments``) can't be
  // driven by scalar rows — ``String({…})`` would render "[object Object]"
  // and a save would clobber the data. Edit those in the YAML pane.
  if (raw.some((v) => !isPrimitiveOrNullish(v))) {
    return renderYamlOnlyField(entry, path, ctx);
  }
  // Show escape-worthy code points (control / Private-Use, e.g. MDI font
  // glyphs) as ``\U…`` so an otherwise-invisible value is editable, and
  // decode on input (device-builder#1232). Escaping is unconditional so
  // display and input stay a true inverse: a value that merely looks like
  // an escape (``C:\x41bc``) shows with its backslash doubled and decodes
  // back unchanged, rather than being rewritten on a no-op edit. Decoding
  // must stay unconditional too — a freshly added row is empty, so a typed
  // ``\U…`` has to decode without a prior escape-worthy value to gate on.
  // INTEGER / FLOAT lists (lcd user-characters data, microphone channels,
  // ...) get number inputs and coerce each item back to a number on edit, so
  // the YAML serializer emits them unquoted; numeric items are plain
  // stringified numbers and skip the glyph escaping above. Hex-display
  // integers (modbus custom_command, sync_value) stay text: <input
  // type="number"> rejects 0x.. literals and Number("0x76") would both lose
  // the canonical hex form and overflow 64-bit values, same reason the
  // single-value number renderer hands hex off to its own text parser.
  const numeric =
    (entry.type === ConfigEntryType.INTEGER || entry.type === ConfigEntryType.FLOAT) &&
    entry.display_format !== "hex";
  const items: string[] = numeric
    ? raw.map((v) => String(v ?? ""))
    : raw.map((v) => escapeForInput(String(v)));
  const invalid = ctx.errorAt(path) !== null;
  const disabled = effectiveDisabled(entry, ctx);
  const { addItem, removeAt } = arrayItemHandlers(ctx, path, () => "");
  const updateAt = (idx: number, value: string) => {
    const current = [...readArrayAt(ctx, path)];
    // Empty stays "" so a half-typed or cleared row round-trips instead of
    // becoming NaN, matching the single-value number renderer.
    current[idx] = numeric
      ? value === ""
        ? ""
        : Number(value)
      : unescapeForInput(value);
    ctx.emitChange(path, current);
  };

  return html`
    <div class="field" data-field-key=${fieldKeyAttr(path)}>
      ${renderLabel(entry, ctx)} ${renderListEmptyHint(items, ctx)}
      ${items.map(
        (item, i) => html`
          <div class="multi-row">
            <input
              type=${numeric ? "number" : "text"}
              step=${numeric
                ? entry.type === ConfigEntryType.FLOAT
                  ? "any"
                  : "1"
                : nothing}
              class="multi-input ${invalid ? "invalid" : ""}"
              .value=${item}
              ?disabled=${disabled}
              @input=${(e: Event) => updateAt(i, (e.target as HTMLInputElement).value)}
            />
            ${renderListRemoveButton(ctx, disabled, () => removeAt(i))}
          </div>
        `
      )}
      ${renderListAddButton(ctx, disabled, addItem)} ${renderFieldError(path, ctx)}
    </div>
  `;
}

// Free-form map field — user types keys (component domains, substitution
// names, …) and picks values via config_entries[0]'s template. Used for
// logger.logs:, substitutions:, globals:, api.actions:. Storage:
// values[key] = { userKey: userValue, ... }. Renames rebuild to preserve
// order; deletes remove the entry; adds inject new_1, new_2, ….
export function renderMapField(entry: ConfigEntry, path: string[], ctx: RenderCtx) {
  const valueTemplate = (entry.config_entries ?? [])[0];
  const raw = ctx.getAt(path);
  const map: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const keys = Object.keys(map);
  const disabled = effectiveDisabled(entry, ctx);

  // Preserve the source dict's null-prototype shape so YAML keys like
  // __proto__ / constructor stay as own property data instead of mutating
  // Object.prototype. A naive {...obj} spread would silently swap the
  // protection out on the first mutation. (Copilot-flagged.)
  const cloneMap = (src: Record<string, unknown>): Record<string, unknown> =>
    Object.assign(Object.create(null), src);

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

  // Rename preserves order; refuses if newKey exists (would silently merge)
  // or is empty (round-trips badly through YAML).
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

  // Key input commits on blur — committing on every keystroke would re-key
  // the row mid-edit and steal focus. Complex (non-primitive, non-lambda)
  // values render as a "edit in YAML" placeholder so substitutions carrying
  // arbitrary YAML aren't stringified to [object Object] and lost on save.
  const renderRow = (rowKey: string) => {
    const valuePath = [...path, rowKey];
    // A lambda (``!lambda`` object) isn't a structural complex value — it's a
    // templatable scalar the value template renders inline (lambda mode), so
    // route it through the template rather than the edit-in-YAML placeholder.
    const rawValue = map[rowKey];
    const complex = !isPrimitiveOrNullish(rawValue) && !isLambdaValue(rawValue);
    return html`
      <div class="map-row" data-field-key=${fieldKeyAttr(valuePath)}>
        <input
          type="text"
          class="multi-input map-key-input"
          .value=${rowKey}
          ?disabled=${disabled}
          @change=${(e: Event) => renameKey(rowKey, (e.target as HTMLInputElement).value)}
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
    <div class="field" data-field-key=${fieldKeyAttr(path)}>
      ${renderLabel(entry, ctx)}
      ${keys.length === 0
        ? html`<p class="field-description">${ctx.localize("device.map_empty")}</p>`
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

// Repeatable nested-mapping list — esphome.devices / esphome.areas / any
// type=nested, multi_value=true. Each item is a bordered group with the
// children of a single nested entry plus a remove button; trailing Add
// appends an empty item.
// Storage: values[entry.key] = [ {child: value, ...}, ... ]
export function renderNestedListField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx
) {
  // YamlRawValue means the parser preserved the block byte-for-byte (the
  // catalog's flat-mapping contract didn't fit). Bail to a YAML-only notice;
  // without this, asMappingList coerces to [] and the next save replaces the
  // user's preserved YAML with whatever the renderer emits — silent data loss.
  const raw = ctx.getAt(path);
  if (raw instanceof YamlRawValue) {
    return html`
      <div class="nested-list" data-field-key=${fieldKeyAttr(path)}>
        ${renderLabel(entry, ctx)}
        <p class="field-description">${ctx.localize("device.multi_value_yaml_only")}</p>
        ${renderFieldError(path, ctx)}
      </div>
    `;
  }

  const items = asMappingList(raw);
  const disabled = effectiveDisabled(entry, ctx);
  const { addItem, removeAt } = arrayItemHandlers(ctx, path, () => ({}));
  const itemTitle = labelFor(entry, ctx);
  const childrenSchema = entry.config_entries ?? [];

  return html`
    <div class="nested-list" data-field-key=${fieldKeyAttr(path)}>
      ${renderLabel(entry, ctx)} ${renderListEmptyHint(items, ctx)}
      ${items.map((item, i) => {
        const itemPath = [...path, String(i)];
        const renderableChildren = ctx.filterRenderable(childrenSchema, item);
        return html`
          <div class="nested-list-item" data-field-key=${fieldKeyAttr(itemPath)}>
            <div class="nested-list-item-header">
              <span class="nested-list-item-title"> ${itemTitle} ${i + 1} </span>
              ${renderListRemoveButton(ctx, disabled, () => removeAt(i))}
            </div>
            <div class="nested-fields">
              ${renderableChildren.map((child) =>
                ctx.renderEntry(child, [...itemPath, child.key])
              )}
            </div>
          </div>
        `;
      })}
      ${renderListAddButton(ctx, disabled, addItem)} ${renderFieldError(path, ctx)}
    </div>
  `;
}
