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

/**
 * Roving-tabindex tab stop for a choice in a ``role="radiogroup"``: the checked
 * card, or the first card when nothing in the group is checked yet.
 */
export function rovingTabbable(
  selected: boolean,
  anySelected: boolean,
  index: number
): boolean {
  return selected || (!anySelected && index === 0);
}

/**
 * Arrow-key handler for a ``role="radiogroup"`` of choice cards: Up/Left and
 * Down/Right move focus and selection across the enabled cards, wrapping at the
 * ends, per the ARIA radio pattern. Attach to the group's ``@keydown``.
 */
export function onChoiceGroupKeydown(e: KeyboardEvent): void {
  const forward = e.key === "ArrowDown" || e.key === "ArrowRight";
  const back = e.key === "ArrowUp" || e.key === "ArrowLeft";
  if (!forward && !back) return;
  const group = e.currentTarget as HTMLElement;
  const cards = Array.from(
    group.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])')
  );
  if (cards.length === 0) return;
  const active = (e.target as HTMLElement | null)?.closest('[role="radio"]') ?? null;
  const current = active ? cards.indexOf(active as HTMLElement) : -1;
  const next =
    cards[(Math.max(current, 0) + (forward ? 1 : -1) + cards.length) % cards.length];
  e.preventDefault();
  next.focus();
  next.click();
}
