import { html, nothing, type TemplateResult } from "lit";

/**
 * Shared ``.term-btn`` render helpers for process-terminal driver toolbars.
 *
 * Render functions (not a custom element) so drivers can interpolate them
 * directly inside their own ``render()`` — which is what styles the projected
 * markup (see ``termButtonStyles`` for the cross-shadow-root rationale) — and
 * so the existing renderer-walking tests still see the buttons. They take
 * already-localized strings; localization stays in the driver.
 */

export interface TermButtonOpts {
  /** mdi icon name (registered by the driver). Omit for a text-only button. */
  icon?: string;
  /** Already-localized label. Omit for an icon-only button. */
  label?: string;
  /** Tooltip + accessible name; falls back to ``label``. */
  title?: string;
  variant?: "ghost" | "start" | "stop";
  /** Adds ``is-active`` (ghost toggles) and reflects ``aria-pressed``. */
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function renderTermButton(opts: TermButtonOpts): TemplateResult {
  const variant = opts.variant ?? "ghost";
  const title = opts.title ?? opts.label;
  return html`<button
    class="term-btn term-btn--${variant} ${opts.active ? "is-active" : ""}"
    ?disabled=${opts.disabled ?? false}
    title=${title ?? nothing}
    aria-label=${opts.label ? nothing : (title ?? nothing)}
    aria-pressed=${opts.active === undefined ? nothing : opts.active ? "true" : "false"}
    @click=${opts.onClick}
  >
    ${opts.icon ? html`<wa-icon library="mdi" name=${opts.icon}></wa-icon>` : nothing}
    ${opts.label ?? nothing}
  </button>`;
}

export interface TermToggleOpts {
  active: boolean;
  onClick: () => void;
  /** Single icon, or distinct active/inactive icons. */
  icon?: string;
  iconActive?: string;
  iconInactive?: string;
  /** Single label, or distinct active/inactive labels. */
  label?: string;
  labelActive?: string;
  labelInactive?: string;
  /** Already-resolved tooltip for the current state. */
  title?: string;
}

/** A ghost toggle: ``is-active`` + ``aria-pressed`` track ``active``. */
export function renderTermToggle(opts: TermToggleOpts): TemplateResult {
  const icon = opts.active
    ? (opts.iconActive ?? opts.icon)
    : (opts.iconInactive ?? opts.icon);
  const label = opts.active
    ? (opts.labelActive ?? opts.label)
    : (opts.labelInactive ?? opts.label);
  return renderTermButton({
    icon,
    label,
    title: opts.title,
    variant: "ghost",
    active: opts.active,
    onClick: opts.onClick,
  });
}
