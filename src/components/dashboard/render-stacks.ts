import { mdiChevronDown, mdiMemory } from "@mdi/js";
import { css, html, type TemplateResult } from "lit";
import type { ESPHomePageDashboard } from "../../pages/dashboard.js";
import { registerMdiIcons } from "../../util/register-icons.js";

registerMdiIcons({
  "chevron-down": mdiChevronDown,
  memory: mdiMemory,
});

/** The remote compute stack: the panel owns its own collapse header. */
export function renderRemoteStack(host: ESPHomePageDashboard): TemplateResult {
  return html`
    <esphome-remote-build-panel
      .collapsed=${host._remoteStackCollapsed}
      @toggle-collapsed=${host._onToggleRemoteStack}
    ></esphome-remote-build-panel>
  `;
}

/**
 * The device builder stack: collapsible wrapper around the normal
 * discovered/toolbar/grid content. Only rendered while the remote stack is
 * visible — a plain install gets the content unwrapped.
 */
export function renderBuilderStack(
  host: ESPHomePageDashboard,
  content: TemplateResult
): TemplateResult {
  const collapsed = host._builderStackCollapsed;
  return html`
    <section
      class="builder-stack"
      aria-label=${host._localize("dashboard.builder_stack_heading")}
    >
      <button
        type="button"
        class="builder-stack-header"
        aria-expanded=${collapsed ? "false" : "true"}
        @click=${host._onToggleBuilderStack}
      >
        <wa-icon library="mdi" name="memory"></wa-icon>
        <span class="builder-stack-title">
          ${host._localize("dashboard.builder_stack_heading")}
        </span>
        <wa-icon
          class="builder-stack-chevron"
          library="mdi"
          name="chevron-down"
          aria-hidden="true"
        ></wa-icon>
      </button>
      ${collapsed ? "" : content}
    </section>
  `;
}

/** Mirrors the remote panel's banner so the two stack headers read as one system. */
export const dashboardStacksStyles = css`
  /* Stacks mode: the discovery banner belongs to the Device builder
     section, so it flows in place of its usual float at the page top
     (and the float's compensating top padding goes too). The toolbar's
     top padding tightens to match — the pill is a row now, not a float
     the toolbar needs to clear. */
  :host([stacks][has-discovered]) {
    padding-top: 0;
  }

  :host([stacks]) {
    --toolbar-pad-top: var(--wa-space-s);
  }

  :host([stacks]) .discovered-section {
    position: static;
    margin: 0;
    pointer-events: auto;
  }

  /* In-flow means anchored: the pill and its expanded grid span the
     section instead of floating as a centered strip mid-page. */
  :host([stacks]) .discovered-section-header,
  :host([stacks]) .discovered-section-grid {
    width: 100%;
  }

  :host([stacks]) .discovered-section-header {
    border-top: var(--wa-border-width-s) solid var(--esphome-primary);
    border-radius: var(--wa-border-radius-l) var(--wa-border-radius-l) 0 0;
    animation: none;
  }

  :host([stacks])
    .discovered-section:has(.discovered-section-grid[hidden])
    .discovered-section-header {
    border-radius: var(--wa-border-radius-l);
  }

  /* Geometry mirrors the panel banner exactly so the two icons and the
     two chevrons sit on the same vertical lines. Outlined bar in the
     discovery pill's visual language; hover tints the whole bar. */
  .builder-stack-header {
    display: flex;
    align-items: center;
    width: 100%;
    box-sizing: border-box;
    gap: var(--wa-space-s);
    padding: var(--wa-space-xs) var(--wa-space-s);
    margin: 0 0 var(--wa-space-s);
    border: var(--wa-border-width-s) solid var(--esphome-primary);
    border-radius: var(--wa-border-radius-m);
    background: transparent;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }

  .builder-stack-header:hover,
  .builder-stack-header:focus-visible {
    background: var(--esphome-primary-light);
    outline: none;
  }

  .builder-stack-header > wa-icon:first-child {
    font-size: 22px;
    color: var(--esphome-primary);
  }

  .builder-stack-title {
    font-size: var(--wa-font-size-l);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  .builder-stack-chevron {
    margin-left: auto;
    font-size: 22px;
    color: var(--wa-color-text-quiet);
    transition: transform 0.15s;
  }

  .builder-stack-header[aria-expanded="true"] .builder-stack-chevron {
    transform: rotate(180deg);
  }
`;
