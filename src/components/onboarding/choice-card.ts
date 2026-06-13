import { type TemplateResult, html } from "lit";

export interface ChoiceCardProps {
  /** mdi icon name; the caller is responsible for registering it. */
  icon: string;
  title: string;
  description: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * A large selectable card used for the wizard's use-case and experience
 * picks. ``aria-checked`` is the string-attribute form (a boolean binding
 * would drop the attribute on ``false`` and break the CSS + a11y state).
 */
export function renderChoiceCard(props: ChoiceCardProps): TemplateResult {
  return html`
    <button
      type="button"
      class="choice-card ${props.selected ? "selected" : ""}"
      role="radio"
      aria-checked=${props.selected ? "true" : "false"}
      ?disabled=${props.disabled ?? false}
      @click=${props.onSelect}
    >
      <wa-icon library="mdi" name=${props.icon} class="choice-icon"></wa-icon>
      <span class="choice-text">
        <span class="choice-title">${props.title}</span>
        <span class="choice-desc">${props.description}</span>
      </span>
    </button>
  `;
}
