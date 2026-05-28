import { html, nothing } from "lit";
import type { ConfigEntry } from "../../../api/types.js";
import { asRecord } from "../../../util/nested-values.js";
import { renderMarkdown } from "../../../util/markdown.js";
import { hasSerializableValue } from "../../../util/yaml-serialize.js";
import {
  effectiveDisabled,
  labelFor,
  renderHelpLink,
  type RenderCtx,
} from "../config-entry-renderers-shared.js";

// Stash of the values a sub-reading held when its enable switch was
// turned off, keyed by the form's ``stashOwner`` (the host element,
// stable across re-renders) then the dotted path. Turning the switch
// back on restores the stash so an accidental toggle doesn't wipe the
// unit / accuracy / filters the user configured — only the next flip
// back recovers it (mirrors the templatable literal/lambda stash).
const _enableStashes = new WeakMap<object, Map<string, Record<string, unknown>>>();

function _enableStash(ctx: RenderCtx): Map<string, Record<string, unknown>> {
  let m = _enableStashes.get(ctx.stashOwner);
  if (!m) {
    m = new Map();
    _enableStashes.set(ctx.stashOwner, m);
  }
  return m;
}

// In requiredOnly mode (add-component dialog) groups default open and the
// set tracks groups the user explicitly *collapsed*. Otherwise groups default
// closed and the set tracks groups they *opened*.
export function renderNestedField(entry: ConfigEntry, path: string[], ctx: RenderCtx) {
  const key = path.join(".");
  const inSet = ctx.nestedOpenSections.has(key);
  const isOpen = ctx.requiredOnly ? !inSet : inSet;
  const renderableChildren = ctx.filterRenderable(
    entry.config_entries ?? [],
    ctx.scopeValues(path)
  );
  // Optional entity sub-readings (a debug component's per-metric sensors,
  // a DHT's temperature/humidity, …) are only written to YAML once their
  // group holds a value, so an untouched one is silently "off". Give those
  // an explicit enable switch; plain nested forms (platform_type === null)
  // and required groups keep the bare collapsible header.
  const isOptionalEntity = entry.platform_type != null && !entry.required;
  const enabled = isOptionalEntity && hasSerializableValue(ctx.getAt(path));
  const label = labelFor(entry, ctx);
  const enableLabel = ctx.localize("device.enable_entity", { name: label });
  return html`
    <div class="nested-group" data-field-key=${path.join(".")}>
      <div class="nested-header">
        ${isOptionalEntity
          ? html`<wa-switch
              class="nested-enable"
              .checked=${enabled}
              ?disabled=${effectiveDisabled(entry, ctx)}
              aria-label=${enableLabel}
              title=${enableLabel}
              @click=${(e: Event) => e.stopPropagation()}
              @change=${(e: Event) =>
                _onEnableToggle(
                  path,
                  key,
                  isOpen,
                  (e.target as HTMLInputElement & { checked: boolean }).checked,
                  label,
                  ctx
                )}
            ></wa-switch>`
          : nothing}
        <button
          type="button"
          class="nested-toggle"
          aria-expanded=${isOpen}
          @click=${() => ctx.toggleNested(key)}
        >
          <wa-icon library="mdi" name=${isOpen ? "chevron-up" : "chevron-down"}></wa-icon>
          <span class="nested-title">${label}</span>
          ${entry.platform_type
            ? html`<span class="nested-platform">${entry.platform_type}</span>`
            : nothing}
        </button>
        ${renderHelpLink(entry, ctx)}
      </div>
      ${entry.description
        ? html`<p class="nested-desc">${renderMarkdown(entry.description)}</p>`
        : nothing}
      ${isOpen
        ? html`<div class="nested-fields">
            ${renderableChildren.map((child) =>
              ctx.renderEntry(child, [...path, child.key])
            )}
          </div>`
        : nothing}
    </div>
  `;
}

// Enabling restores the values stashed by the last disable (so an
// accidental off/on round-trip keeps the user's settings); with no
// stash it seeds the entity's name (its label, editable) so the group
// becomes non-empty and serializes. Either way it expands for editing.
// Disabling stashes the current group, then clears it — the serializer
// prunes the empty object so the block leaves the YAML — and collapses.
function _onEnableToggle(
  path: string[],
  key: string,
  isOpen: boolean,
  checked: boolean,
  label: string,
  ctx: RenderCtx
): void {
  const stash = _enableStash(ctx);
  const stashKey = key;
  if (checked) {
    const restored = stash.get(stashKey);
    if (restored && hasSerializableValue(restored)) {
      stash.delete(stashKey);
      ctx.emitChange(path, restored);
    } else {
      ctx.emitChange([...path, "name"], label);
    }
    if (!isOpen) ctx.toggleNested(key);
  } else {
    const current = ctx.getAt(path);
    if (hasSerializableValue(current)) {
      stash.set(stashKey, asRecord(current));
    }
    ctx.emitChange(path, undefined);
    if (isOpen) ctx.toggleNested(key);
  }
}
