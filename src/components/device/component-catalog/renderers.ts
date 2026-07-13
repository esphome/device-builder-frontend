import { html, nothing, type TemplateResult } from "lit";
import type { FeaturedBundle } from "../../../api/types/boards.js";
import type { ComponentCatalogEntry } from "../../../api/types/components.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { renderMarkdown } from "../../../util/markdown.js";
import {
  categoryChipLabel,
  platformLabel,
  shouldShowCategoryChip,
} from "../component-card-category-label.js";
import type { ESPHomeComponentCatalog } from "../component-catalog.js";

// Skip when the click landed on an inner anchor or button so they
// keep their own behavior (more-info, expand, "+ Add", md links).
export function shouldHandleCardClick(ev: MouseEvent): boolean {
  const target = ev.target as Element | null;
  return !target?.closest("a, button");
}

// Native title tooltips don't render inside the dialog's top layer
// (Chromium suppresses them over showModal dialogs), so the
// recommendation explainer rides a wa-tooltip anchored to the chip.
// An empty tooltip (board body not yet hydrated) renders the chip
// alone, rather than naming a placeholder board.
function renderRecommendedChip(chipId: string, tooltip: string): TemplateResult {
  return html`<span
      id=${chipId}
      class="component-category-chip component-category-chip--recommended"
      tabindex=${tooltip ? "0" : "-1"}
      >${categoryChipLabel("featured")}</span
    >
    ${tooltip ? html`<wa-tooltip for=${chipId}>${tooltip}</wa-tooltip>` : nothing}`;
}

function renderExpandButton(host: ESPHomeComponentCatalog, id: string): TemplateResult {
  const expanded = host._expandedId === id;
  return html`<button
    class="expand-button"
    type="button"
    aria-pressed=${expanded}
    title=${host._localize("wizard.expand_board")}
    @click=${() => host._onToggleExpand(id)}
  >
    <wa-icon
      library="mdi"
      name=${expanded ? "arrow-collapse-all" : "arrow-expand-all"}
    ></wa-icon>
  </button>`;
}

export function renderBundleCard(
  host: ESPHomeComponentCatalog,
  bundle: FeaturedBundle
): TemplateResult {
  const hasImage = !!bundle.image_url && !host._imageFailed.has(bundle.id);
  const recommendedTooltip = host.board
    ? host._localize("device.recommended_chip_tooltip", { board: host.board.name })
    : "";
  // Bundle ids are board-local tokens (rgb_buzzer_module) that could
  // collide with a bare core-component id (debug, wifi) in the shared
  // expanded/overflow namespaces; the prefix keeps them apart.
  const expandKey = `bundle.${bundle.id}`;
  const expanded = host._expandedId === expandKey;
  const expandable = expanded || host._overflowingDescriptions.has(expandKey);
  return html`
    <article
      class="component-card component-card--featured ${
        expanded ? "component-card--expanded" : ""
      }"
      @click=${(ev: MouseEvent) => {
        if (shouldHandleCardClick(ev)) host._onAddBundle(bundle);
      }}
    >
      <div class="component-card-header">
        ${
          hasImage
            ? html`<div class="component-image">
                <img
                  src=${bundle.image_url}
                  alt=${bundle.name}
                  referrerpolicy="no-referrer"
                  loading="lazy"
                  @error=${() => host._onImageError(bundle.id)}
                />
              </div>`
            : html`<div class="component-image--placeholder">
                <wa-icon library="mdi" name="package-variant-closed"></wa-icon>
              </div>`
        }
        <div class="component-card-header-text">
          <h3 class="component-title">${bundle.name}</h3>
          ${renderRecommendedChip(
            `recommended-chip-bundle-${bundle.id}`,
            recommendedTooltip
          )}
        </div>
        <span class="bundle-badge">
          <wa-icon library="mdi" name="package-variant-closed"></wa-icon>
          ${host._localize("device.featured_bundle_badge")}
        </span>
        ${expandable ? renderExpandButton(host, expandKey) : nothing}
      </div>
      ${
        bundle.description
          ? html`<p
              class="component-description ${
                expanded ? "" : "component-description--clamp"
              }"
              data-component-id=${expandKey}
            >
              ${renderMarkdown(bundle.description)}
            </p>`
          : nothing
      }
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
  showPlatform = false
): TemplateResult {
  const hasImage = !!component.image_url && !host._imageFailed.has(component.id);
  // Expanding only unclamps the description (plus a full-row span), so the
  // button is dead UI unless the clamped text actually overflows. An open
  // card keeps its button regardless — the unclamped text no longer
  // measures as overflowing, but it still needs a collapse affordance.
  const expandable = expanded || host._overflowingDescriptions.has(component.id);
  // Skip the chip entirely when the label is empty (defensive against an
  // API regression yielding a whitespace category id) so we don't render
  // a blank pill.
  const categoryLabel = shouldShowCategoryChip(host._category)
    ? categoryChipLabel(
        (featured ? component.underlying_category : component.category) ?? ""
      )
    : "";
  // Surfaced only when this card shares a name with another in the same
  // category; the category chip can't tell same-domain platforms apart.
  const platform = showPlatform ? platformLabel(component.id) : "";
  const recommendedTooltip =
    featured && host.board
      ? localize("device.recommended_chip_tooltip", { board: host.board.name })
      : "";
  return html`
    <article
      class="component-card ${expanded ? "component-card--expanded" : ""} ${
        featured ? "component-card--featured" : ""
      }"
      @click=${(ev: MouseEvent) => {
        if (shouldHandleCardClick(ev)) host._onAdd(component);
      }}
    >
      <div class="component-card-header">
        ${
          hasImage
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
              </div>`
        }
        <div class="component-card-header-text">
          <h3 class="component-title">${component.name}</h3>
          ${
            featured
              ? renderRecommendedChip(
                  `recommended-chip-${component.id}`,
                  recommendedTooltip
                )
              : nothing
          }
          ${
            categoryLabel
              ? html`<span class="component-category-chip">${categoryLabel}</span>`
              : nothing
          }
          ${
            platform
              ? html`<span class="component-category-chip">${platform}</span>`
              : nothing
          }
        </div>
        ${expandable ? renderExpandButton(host, component.id) : nothing}
      </div>
      <p
        class="component-description ${expanded ? "" : "component-description--clamp"}"
        data-component-id=${component.id}
      >
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
