import { html, nothing } from "lit";
import type { ConfigEntry } from "../../../api/types.js";
import { renderMarkdown } from "../../../util/markdown.js";
import {
  labelFor,
  renderHelpLink,
  type RenderCtx,
} from "../config-entry-renderers-shared.js";

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
  return html`
    <div class="nested-group" data-field-key=${path.join(".")}>
      <div class="nested-header">
        <button
          type="button"
          class="nested-toggle"
          aria-expanded=${isOpen}
          @click=${() => ctx.toggleNested(key)}
        >
          <wa-icon library="mdi" name=${isOpen ? "chevron-up" : "chevron-down"}></wa-icon>
          <span class="nested-title">${labelFor(entry, ctx)}</span>
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
