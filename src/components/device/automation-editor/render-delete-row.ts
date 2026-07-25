/**
 * Edit-mode footer shared by the automation / script / api-action
 * editors: the destructive Delete button plus the confirm dialog
 * that gates it. Pure render function; the host owns the dialog
 * ref that ``onOpenConfirm`` opens and routes ``onConfirm`` to its
 * delete engine.
 */
import { mdiDelete } from "@mdi/js";
import { html } from "lit";

import { registerMdiIcons } from "../../../util/register-icons.js";
import "../../confirm-dialog.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ delete: mdiDelete });

export function renderDeleteRow(opts: {
  label: string;
  message: string;
  disabled: boolean;
  onOpenConfirm: () => void;
  onConfirm: () => void;
}) {
  return html`<div class="ae-actions">
      <button
        type="button"
        class="ae-danger"
        ?disabled=${opts.disabled}
        @click=${opts.onOpenConfirm}
      >
        <wa-icon library="mdi" name="delete"></wa-icon>
        ${opts.label}
      </button>
    </div>
    <esphome-confirm-dialog
      heading=${opts.label}
      confirm-label=${opts.label}
      message=${opts.message}
      destructive
      @confirm=${opts.onConfirm}
    ></esphome-confirm-dialog>`;
}
