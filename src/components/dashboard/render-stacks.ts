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

  /* The pill keeps its classic hanging look, but hangs from the Device
     builder header bar instead of the page header: pulled up over the
     bar's bottom border so the two read as one attached element. */
  :host([stacks]) .discovered-section {
    position: static;
    margin: calc(-1 * var(--wa-space-s) - var(--wa-border-width-s)) 0 0;
    pointer-events: auto;
  }

  :host([stacks]) .discovered-section-header {
    animation: none;
  }

  /* Geometry mirrors the panel banner exactly so the two icons and the
     two chevrons sit on the same vertical lines — and both share the app
     header's gutter, so icon and chevron line up with the logo and the
     kebab above. Square edge-to-edge strips (top/bottom borders only) so
     the accordion reads as an extension of the header. */
  .builder-stack-header {
    display: flex;
    align-items: center;
    width: 100%;
    box-sizing: border-box;
    gap: var(--wa-space-s);
    padding: var(--wa-space-xs) var(--content-gutter, var(--wa-space-l));
    margin: 0 0 var(--wa-space-s);
    border: none;
    border-top: var(--wa-border-width-s) solid var(--esphome-primary);
    border-bottom: var(--wa-border-width-s) solid var(--esphome-primary);
    border-radius: 0;
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

  /* Single accordion unit: adjacent bars share one border line. */
  esphome-remote-build-panel[collapsed] + .builder-stack .builder-stack-header {
    margin-top: calc(-1 * var(--wa-border-width-s));
  }

  .builder-stack-header > wa-icon:first-child {
    font-size: 20px;
    color: var(--esphome-primary);
  }

  .builder-stack-title {
    font-size: var(--wa-font-size-m);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  .builder-stack-chevron {
    margin-left: auto;
    font-size: 20px;
    color: var(--wa-color-text-quiet);
    transition: transform 0.15s;
  }

  .builder-stack-header[aria-expanded="true"] .builder-stack-chevron {
    transform: rotate(180deg);
  }

  /* Use the whole viewport: the page fills down to the footer and the
     expanded remote section stretches into whatever is left. */
  :host([stacks][view="cards"]) {
    min-height: calc(
      100dvh - var(--esphome-header-height) - var(--esphome-footer-height)
    );
  }

  :host([stacks]) esphome-remote-build-panel:not([collapsed]) {
    flex: 1;
    min-height: 0;
  }
`;
