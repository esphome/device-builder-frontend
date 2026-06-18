import { mdiChevronDown } from "@mdi/js";
import { type TemplateResult, html, nothing } from "lit";

import type { LocalizeFunc } from "../../common/localize.js";
import { registerMdiIcons } from "../../util/register-icons.js";

// The `<wa-icon>` element itself is registered by the consuming component
// (every caller already imports it); a pure render helper must not pull the
// element's side-effect import, which would break node-env renderer tests.
registerMdiIcons({ "chevron-down": mdiChevronDown });

export interface DisclosureOptions {
  /** Whether the panel is shown. The caller owns this state. */
  open: boolean;
  /** Fired on toggle-button click; the caller flips its own `open`. Receives
   *  the click event so an existing event handler can be passed directly; a
   *  zero-arg arrow is also fine (extra params are ignored). */
  onToggle: (event: Event) => void;
  localize: LocalizeFunc;
  /** Translation key for the toggle label. */
  labelKey: string;
  /** Panel content; called (and built) only while `open`, so a collapsed
   *  disclosure never constructs its body or runs its render side effects. */
  body: () => TemplateResult;
  /** Label styling; see `disclosureStyles`. Defaults to `"link"`. */
  variant?: "link" | "heading" | "quiet";
  /** Render the chevron before the label instead of after. */
  iconBefore?: boolean;
  disabled?: boolean;
  /** When set, ids the panel and wires `aria-controls` while open. */
  panelId?: string;
}

/**
 * Shared "advanced options" disclosure: a button + rotating chevron that
 * toggles `aria-expanded` and reveals `body`.
 *
 * Controlled — the caller passes `open` + `onToggle`, so it fits
 * component-local, parent-owned, and external (context-set) open-state alike.
 * Pair with `disclosureStyles` (src/styles/disclosure.ts) in the consumer's
 * `static styles`.
 */
export function renderDisclosure(opts: DisclosureOptions): TemplateResult {
  const { open, variant = "link", iconBefore = false, panelId } = opts;
  const label = html`<span class="disclosure-toggle__label">
    ${opts.localize(opts.labelKey)}
  </span>`;
  const chevron = html`<wa-icon
    class="disclosure-toggle__chevron"
    library="mdi"
    name="chevron-down"
    aria-hidden="true"
  ></wa-icon>`;
  return html`
    <button
      type="button"
      class="disclosure-toggle disclosure-toggle--${variant}"
      aria-expanded=${open ? "true" : "false"}
      aria-controls=${open && panelId ? panelId : nothing}
      ?disabled=${opts.disabled ?? false}
      @click=${opts.onToggle}
    >
      ${iconBefore ? html`${chevron}${label}` : html`${label}${chevron}`}
    </button>
    ${open
      ? html`<div id=${panelId ?? nothing} class="disclosure-panel">${opts.body()}</div>`
      : nothing}
  `;
}
