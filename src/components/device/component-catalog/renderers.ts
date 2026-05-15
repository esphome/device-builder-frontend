import { html, nothing, type TemplateResult } from "lit";
import type {
  ComponentCatalogEntry,
  FeaturedBundle,
} from "../../../api/types.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { renderMarkdown } from "../../../util/markdown.js";
import {
  categoryChipLabel,
  shouldShowCategoryChip,
} from "../component-card-category-label.js";
import type { ESPHomeComponentCatalog } from "../component-catalog.js";

// Skip when the click landed on an inner anchor or button so they
// keep their own behavior (more-info, expand, "+ Add", md links).
export function shouldHandleCardClick(ev: MouseEvent): boolean {
  const target = ev.target as Element | null;
  return !target?.closest("a, button");
}

export function renderBundleCard(
  host: ESPHomeComponentCatalog,
  bundle: FeaturedBundle,
): TemplateResult {
  return html`
    <article
      class="component-card component-card--featured"
      @click=${(ev: MouseEvent) => {
        if (shouldHandleCardClick(ev)) host._onAddBundle(bundle);
      }}
    >
      <div class="component-card-header">
        <div class="component-image--placeholder">
          <wa-icon library="mdi" name="package-variant-closed"></wa-icon>
        </div>
        <div class="component-card-header-text">
          <h3 class="component-title">${bundle.name}</h3>
        </div>
        <span class="bundle-badge">
          <wa-icon library="mdi" name="package-variant-closed"></wa-icon>
          ${host._localize("device.featured_bundle_badge")}
        </span>
      </div>
      ${bundle.description
        ? html`<p class="component-description component-description--clamp">
            ${renderMarkdown(bundle.description)}
          </p>`
        : nothing}
      <div class="card-footer">
        <span></span>
        <button
          class="select-component"
          type="button"
          @click=${() => host._onAddBundle(bundle)}
        >
          <wa-icon library="mdi" name="plus"></wa-icon>
          ${host._localize("device.add_component_action")}
        </button>
      </div>
    </article>
  `;
}

export function renderCard(
  host: ESPHomeComponentCatalog,
  component: ComponentCatalogEntry,
  expanded: boolean,
  featured: boolean,
  localize: LocalizeFunc,
): TemplateResult {
  const hasImage = !!component.image_url && !host._imageFailed.has(component.id);
  // Skip the chip entirely when the label is empty (defensive against an
  // API regression yielding a whitespace category id) so we don't render
  // a blank pill.
  const categoryLabel = shouldShowCategoryChip(host._category)
    ? categoryChipLabel(component.category)
    : "";
  return html`
    <article
      class="component-card ${expanded ? "component-card--expanded" : ""} ${featured
        ? "component-card--featured"
        : ""}"
      @click=${(ev: MouseEvent) => {
        if (shouldHandleCardClick(ev)) host._onAdd(component);
      }}
    >
      <div class="component-card-header">
        ${hasImage
          ? html`<div class="component-image">
              <img
                src=${component.image_url}
                alt=${component.name}
                referrerpolicy="no-referrer"
                loading="lazy"
                @error=${() => host._onImageError(component.id)}
              />
            </div>`
          : html`<div class="component-image--placeholder">
              <wa-icon library="mdi" name="memory"></wa-icon>
            </div>`}
        <div class="component-card-header-text">
          <h3 class="component-title">${component.name}</h3>
          ${categoryLabel
            ? html`<span class="component-category-chip">${categoryLabel}</span>`
            : nothing}
        </div>
        <button
          class="expand-button"
          type="button"
          aria-pressed=${expanded}
          title=${localize("wizard.expand_board")}
          @click=${() => host._onToggleExpand(component)}
        >
          <wa-icon
            library="mdi"
            name=${expanded ? "arrow-collapse-all" : "arrow-expand-all"}
          ></wa-icon>
        </button>
      </div>
      <p class="component-description ${expanded ? "" : "component-description--clamp"}">
        ${renderMarkdown(component.description)}
      </p>
      <div class="card-footer">
        <a class="more-info" href=${component.docs_url} target="_blank" rel="noreferrer">
          ${localize("device.more_info")}
          <wa-icon library="mdi" name="open-in-new"></wa-icon>
        </a>
        <button
          class="select-component"
          type="button"
          @click=${() => host._onAdd(component)}
        >
          <wa-icon library="mdi" name="plus"></wa-icon>
          ${localize("device.add_component_action")}
        </button>
      </div>
    </article>
  `;
}
