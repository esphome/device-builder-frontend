import { html, nothing } from "lit";
import type { ConfigEntry } from "../../../api/types.js";
import { asMappingList, isPrimitiveOrNullish } from "../../../util/nested-values.js";
import { YamlRawValue } from "../../../util/yaml-serialize.js";
import {
  effectiveDisabled,
  labelFor,
  renderFieldError,
  renderLabel,
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

function renderListEmptyHint(items: readonly unknown[], ctx: RenderCtx) {
  return items.length === 0
    ? html`<p class="field-description">${ctx.localize("device.multi_value_empty")}</p>`
    : nothing;
}

function renderListRemoveButton(ctx: RenderCtx, disabled: boolean, onClick: () => void) {
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

function renderListAddButton(ctx: RenderCtx, disabled: boolean, onClick: () => void) {
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
  const items: string[] = readArrayAt(ctx, path).map((v) => String(v));
  const invalid = ctx.errorAt(path) !== null;
  const disabled = effectiveDisabled(entry, ctx);
  const { addItem, removeAt } = arrayItemHandlers(ctx, path, () => "");
  const updateAt = (idx: number, value: string) => {
    const current = [...readArrayAt(ctx, path)];
    current[idx] = value;
    ctx.emitChange(path, current);
  };

  return html`
    <div class="field" data-field-key=${path.join(".")}>
      ${renderLabel(entry, ctx)} ${renderListEmptyHint(items, ctx)}
      ${items.map(
        (item, i) => html`
          <div class="multi-row">
            <input
              type="text"
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
  // the row mid-edit and steal focus. Non-primitive values render as a
  // "edit in YAML" placeholder so substitutions carrying arbitrary YAML
  // aren't stringified to [object Object] and lost on save.
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
    <div class="field" data-field-key=${path.join(".")}>
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
      <div class="nested-list" data-field-key=${path.join(".")}>
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
    <div class="nested-list" data-field-key=${path.join(".")}>
      ${renderLabel(entry, ctx)} ${renderListEmptyHint(items, ctx)}
      ${items.map((item, i) => {
        const itemPath = [...path, String(i)];
        const renderableChildren = ctx.filterRenderable(childrenSchema, item);
        return html`
          <div class="nested-list-item" data-field-key=${itemPath.join(".")}>
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
