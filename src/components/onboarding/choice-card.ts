import { type TemplateResult, html, nothing } from "lit";

export interface ChoiceCardProps {
  /** mdi icon name; the caller is responsible for registering it.
   *  Ignored when ``imageSrc`` is set. */
  icon?: string;
  /** Image URL rendered instead of the mdi icon (e.g. a brand logo that
   *  has no mdi glyph). */
  imageSrc?: string;
  title: string;
  description: string;
  selected: boolean;
  /** Roving-tabindex tab stop: the checked card, or the first when none is. */
  tabbable: boolean;
  /** Localized badge text rendered over the card border; also gives the
   *  recommended default an accent border before it is selected. */
  badge?: string;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * A large selectable card used for the wizard's use-case and experience
 * picks. ``aria-checked`` is the string-attribute form (a boolean binding
 * would drop the attribute on ``false`` and break the CSS + a11y state).
 * One ``tabbable`` card per group is the tab stop; pair with
 * ``onChoiceGroupKeydown`` on the ``radiogroup`` for arrow-key navigation.
 */
export function renderChoiceCard(props: ChoiceCardProps): TemplateResult {
  return html`
    <button
      type="button"
      class="choice-card ${props.selected ? "selected" : ""} ${
        props.badge ? "recommended" : ""
      }"
      role="radio"
      aria-checked=${props.selected ? "true" : "false"}
      tabindex=${props.tabbable ? "0" : "-1"}
      ?disabled=${props.disabled ?? false}
      @click=${props.onSelect}
    >
      ${
        props.imageSrc
          ? html`<img class="choice-icon choice-image" src=${props.imageSrc} alt="" />`
          : html`<wa-icon
              library="mdi"
              name=${props.icon ?? ""}
              class="choice-icon"
            ></wa-icon>`
      }
      <span class="choice-text">
        <span class="choice-title">${props.title}</span>
        <span class="choice-desc">${props.description}</span>
      </span>
      ${props.badge ? html`<span class="choice-badge">${props.badge}</span>` : nothing}
    </button>
  `;
}

// The radiogroup helpers moved to ``shared/choice-group.ts`` so
// non-wizard consumers (the pin wiring cards) don't import the
// onboarding module; re-exported to keep this module's surface.
export { onChoiceGroupKeydown, rovingTabbable } from "../shared/choice-group.js";
