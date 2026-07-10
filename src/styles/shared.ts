/**
 * Shared CSS styles for ESPHome frontend components.
 *
 * Only ESPHome-specific brand tokens live here.
 * For typography, spacing, borders, shadows, and transitions use the
 * WebAwesome design tokens directly:  --wa-font-size-*, --wa-space-*,
 * --wa-border-radius-*, --wa-shadow-*, --wa-transition-*, etc.
 */
import { css } from "lit";

/** ESPHome brand colors and design tokens. */
export const espHomeStyles = css`
  :host {
    /* ─── Brand colors ───
       The raw palette (--esphome-primary, --esphome-on-primary, and the
       --esphome-success/warning/error/offline status colors) is the single
       source in index.html — each is an HA theme var with a fallback. Here we
       derive the brand variants from --esphome-primary so they track it. */
    --esphome-primary-hover: color-mix(in srgb, var(--esphome-primary), black 10%);
    --esphome-primary-light: color-mix(in srgb, var(--esphome-primary) 12%, transparent);
    --esphome-secondary: color-mix(in srgb, var(--esphome-primary), black 8%);

    /* Keyboard focus ring, defined once so every :focus-visible glow
       stays consistent. Two sizes: the default 3px ring for inputs /
       fields, and a 2px "tight" ring for compact controls (chips,
       pills, icon buttons). Used as the full box-shadow value. */
    --esphome-focus-ring: 0 0 0 3px
      color-mix(in srgb, var(--esphome-primary), transparent 80%);
    --esphome-focus-ring-tight: 0 0 0 2px
      color-mix(in srgb, var(--esphome-primary), transparent 70%);

    /* Hover affordance for clickable rows / cards / option tiles: a primary
       ring plus the focus-ring glow, matching a focused input. Bundled into
       one box-shadow (inset ring + outer glow) so a :hover only sets
       box-shadow + border-color: transparent — no per-site border juggling. */
    --esphome-hover-ring:
      inset 0 0 0 var(--wa-border-width-s) var(--esphome-primary),
      var(--esphome-focus-ring);

    /* Elevation glow for raised primary action buttons (save, add,
       etc.); rest + hover pair so the lift on hover stays consistent.
       Bigger floating surfaces (the FAB, the round add-device badge)
       keep their own larger, multi-layer shadows. Used as the full
       box-shadow value. */
    --esphome-primary-shadow: 0 2px 8px
      color-mix(in srgb, var(--esphome-primary), transparent 50%);
    --esphome-primary-shadow-hover: 0 4px 14px
      color-mix(in srgb, var(--esphome-primary), transparent 35%);

    /* Translucent primary tints for hover / selected / active state
       backgrounds and borders, defined once so the dozens of these
       across the app stop drifting between 80–96% opacity. Three fill
       intensities (faint hover wash → standard hover/selected → strong
       hover-on-active) and two border weights. Specials that aren't
       generic state tints (the table highlight-glow, the yaml mark,
       the mixed-checkbox fill, muted primary text) keep their own
       inline values. */
    --esphome-tint-faint: color-mix(in srgb, var(--esphome-primary), transparent 95%);
    --esphome-tint: color-mix(in srgb, var(--esphome-primary), transparent 90%);
    --esphome-tint-strong: color-mix(in srgb, var(--esphome-primary), transparent 82%);
    --esphome-tint-border: color-mix(in srgb, var(--esphome-primary), transparent 65%);
    --esphome-tint-border-strong: color-mix(
      in srgb,
      var(--esphome-primary),
      transparent 45%
    );

    /* ─── Layout ─── */
    --esphome-header-height: 56px;
    --esphome-footer-height: 20px;
    /* Height shared by the toolbar's interactive controls (search input,
       view-toggle, facet pills, clear-filters) so the search row stays
       pixel-aligned from one source. */
    --esphome-control-height: 36px;
    /* Shared action-button padding; 18px has no spacing-scale token. */
    --esphome-button-padding: var(--wa-space-xs) 18px;

    font-family: var(--wa-font-family-body);
  }

  /* Compact the header on narrow viewports. 870px is HA's
     sidebar-collapse breakpoint, so embedded in the HA panel this
     fires exactly when HA swaps to its own 40px top bar — matching
     its height avoids a chunky doubled-up bar. Defined on the shared
     token so the header element, the content-area height calcs, the
     actions-menu top offset, and the dashboard toolbar's sticky top
     all shrink together. */
  @media (max-width: 870px) {
    :host {
      --esphome-header-height: 40px;
    }
  }

  /* ─── Custom wa-button variants ─── */

  /* variant="primary": solid --esphome-secondary background, white text */
  wa-button[variant="primary"]::part(base) {
    background-color: var(--esphome-secondary);
    border-color: var(--esphome-secondary);
    color: var(--esphome-on-primary);
  }

  wa-button[variant="primary"]::part(base):hover {
    background-color: color-mix(in srgb, var(--esphome-secondary), black 10%);
    border-color: color-mix(in srgb, var(--esphome-secondary), black 10%);
  }

  /* variant="light": --esphome-primary-light background, --esphome-primary text */
  wa-button[variant="light"]::part(base) {
    background-color: var(--esphome-primary-light);
    color: var(--esphome-primary);
  }

  wa-button[variant="light"]::part(base):hover {
    background-color: color-mix(in srgb, var(--esphome-primary-light), black 5%);
  }

  /* ─── Ghost icon button ───
     Transparent icon-only button for headers and toolbars; the box,
     hover, pressed, and disabled states live here so the per-site copies
     in the page, editor, and navigator shadow roots stay in sync. Call
     sites keep only their real differences, such as icon size, fixed
     dimensions, and margin. */
  .ghost-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--esphome-primary);
    padding: 2px 4px;
    border-radius: 4px;
    cursor: pointer;
  }

  /* Exclude the pressed state, whose filled background would otherwise be
     out-specified by this hover rule and disappear while hovered. */
  .ghost-icon-btn:hover:not(:disabled):not([aria-pressed="true"]) {
    background: var(--esphome-tint-border);
  }

  .ghost-icon-btn[aria-pressed="true"] {
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
  }

  .ghost-icon-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  /* ─── Inline markdown rendering ─── */
  /* Used by util/markdown.ts for links and inline code inside any
     description (config field, board, component, section). */
  .md-link {
    color: var(--esphome-primary);
    text-decoration: underline;
  }

  .md-link:hover {
    text-decoration: none;
  }

  .md-code {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.92em;
    padding: 0 var(--wa-space-2xs);
    border-radius: var(--wa-border-radius-s);
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-normal);
    /* Keep long path-like code from breaking the line awkwardly. */
    word-break: break-word;
  }
`;

/** Common layout helpers. */
export const layoutStyles = css`
  .page-content {
    padding: var(--wa-space-l);
    max-width: 1200px;
    margin: 0 auto;
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: var(--wa-space-m);
  }

  .flex-row {
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
  }

  .flex-col {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-xs);
  }

  .spacer {
    flex: 1;
  }
`;
