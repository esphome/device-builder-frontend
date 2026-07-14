import { html, nothing } from "lit";

/**
 * Option-row content shared by wa-select menus and the options-combobox:
 * the plain label, or a stacked label plus quiet annotation lines (the
 * option's catalog description, the default tag). Styles live in
 * `inputStyles` (`.option-stack` and friends), which both hosts import.
 */
export function renderOptionStack(
  label: unknown,
  description?: string,
  defaultNote?: string
) {
  if (!description && !defaultNote) {
    return html`<span class="option-label">${label}</span>`;
  }
  return html`<span class="option-stack">
    <span class="option-label">${label}</span>
    ${
      description
        ? html`<small class="option-description-note">${description}</small>`
        : nothing
    }
    ${
      defaultNote
        ? html`<small class="option-default-note">${defaultNote}</small>`
        : nothing
    }
  </span>`;
}
