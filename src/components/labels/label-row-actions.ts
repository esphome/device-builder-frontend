/** Per-label rename / delete icon buttons and their styles. */
import { mdiPencilOutline, mdiTrashCanOutline } from "@mdi/js";
import { css, html, type TemplateResult } from "lit";
import type { LocalizeFunc } from "../../common/localize.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "pencil-outline": mdiPencilOutline,
  "trash-can-outline": mdiTrashCanOutline,
});

export function renderLabelRowActions(
  localize: LocalizeFunc,
  onRename: (e: Event) => void,
  onDelete: (e: Event) => void
): TemplateResult {
  const rename = localize("dashboard.labels_rename");
  const del = localize("dashboard.labels_delete");
  return html`<button
      class="row-action"
      type="button"
      aria-label=${rename}
      title=${rename}
      @click=${onRename}
    >
      <wa-icon library="mdi" name="pencil-outline"></wa-icon>
    </button>
    <button
      class="row-action row-action--danger"
      type="button"
      aria-label=${del}
      title=${del}
      @click=${onDelete}
    >
      <wa-icon library="mdi" name="trash-can-outline"></wa-icon>
    </button>`;
}

export const labelRowActionStyles = css`
  .row-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: var(--wa-border-radius-m);
    border: var(--wa-border-width-s) solid transparent;
    background: var(--wa-color-surface-default);
    color: var(--wa-color-text-quiet);
    cursor: pointer;
    padding: 0;
    transition:
      background-color 0.12s,
      border-color 0.12s,
      color 0.12s;
  }

  .row-action:hover {
    background: var(--wa-color-surface-raised);
    border-color: var(--wa-color-surface-border);
    color: var(--wa-color-text-normal);
  }

  .row-action:focus-visible {
    outline: none;
    color: var(--wa-color-text-normal);
    box-shadow: var(--esphome-focus-ring-tight);
  }

  .row-action--danger:hover {
    background: color-mix(in srgb, var(--wa-color-danger-fill-loud), transparent 88%);
    border-color: color-mix(in srgb, var(--wa-color-danger-fill-loud), transparent 70%);
    color: var(--wa-color-danger-fill-loud);
  }

  .row-action--danger:focus-visible {
    box-shadow: 0 0 0 2px
      color-mix(in srgb, var(--wa-color-danger-fill-loud), transparent 70%);
  }

  .row-action wa-icon {
    font-size: 14px;
  }
`;
