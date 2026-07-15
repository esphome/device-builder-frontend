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
      .collapsed=${host._stacks.remoteCollapsed}
      .solo=${host._stacks.builderHidden}
      @toggle-collapsed=${host._stacks.swap}
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
  content: () => TemplateResult
): TemplateResult {
  const collapsed = host._stacks.builderCollapsed;
  return html`
    <section
      class="builder-stack"
      aria-label=${host._localize("dashboard.builder_stack_heading")}
    >
      <button
        type="button"
        class="builder-stack-header stack-bar"
        aria-expanded=${collapsed ? "false" : "true"}
        @click=${host._stacks.swap}
      >
        <wa-icon library="mdi" name="memory"></wa-icon>
        <span class="stack-bar-main">
          <span class="stack-bar-title">
            ${host._localize("dashboard.builder_stack_heading")}
          </span>
          <span class="stack-bar-subtitle">
            ${host._localize("dashboard.builder_stack_tagline")}
          </span>
        </span>
        <wa-icon
          class="stack-bar-chevron"
          library="mdi"
          name="chevron-down"
          aria-hidden="true"
        ></wa-icon>
      </button>
      ${collapsed ? "" : content()}
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

  /* Visuals live in the shared stack-bar fragment; here only the
     section rhythm (one --stack-gap below the bar while its content is
     open — a collapsed bar sits flush) and the joined-unit overlap. */
  .builder-stack-header[aria-expanded="true"] {
    margin-bottom: var(--stack-gap);
  }

  /* Single accordion unit: adjacent bars share one border line. */
  esphome-remote-build-panel[collapsed] + .builder-stack .builder-stack-header {
    margin-top: calc(-1 * var(--wa-border-width-s));
  }

  /* Use the whole viewport: the page fills down to the footer and the
     expanded remote section stretches into whatever is left — and never
     past it; anything long scrolls inside the section. */
  /* vh fallback then dvh — matches the vh/dvh pairing convention in
     dashboard/styles.ts and device-styles.ts for older mobile browsers. */
  :host([stacks][view="cards"]) {
    min-height: calc(100vh - var(--esphome-header-height) - var(--esphome-footer-height));
    min-height: calc(
      100dvh - var(--esphome-header-height) - var(--esphome-footer-height)
    );
  }

  :host([stacks][remote-open][view="cards"]) {
    height: calc(100vh - var(--esphome-header-height) - var(--esphome-footer-height));
    height: calc(100dvh - var(--esphome-header-height) - var(--esphome-footer-height));
    overflow: hidden;
    /* The height calc already reserves the footer; the base view="cards"
       padding would double it as dead space under the bottom bar. */
    padding-bottom: 0;
  }

  :host([stacks]) esphome-remote-build-panel:not([collapsed]) {
    flex: 1;
    min-height: 0;
  }

  /* The expanded builder section is a flex pass-through so fixed-height
     children (the device table) keep their sizing chain to the page. */
  :host([stacks]:not([remote-open])) .builder-stack {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
`;
