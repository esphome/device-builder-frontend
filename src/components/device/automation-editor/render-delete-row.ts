/**
 * Edit-mode footer shared by the automation / script / api-action
 * editors: the destructive Delete button plus the confirm dialog
 * that gates it. Pure render function; the row owns the
 * button-to-dialog wiring and the host only supplies ``onConfirm``.
 */
import { mdiDelete } from "@mdi/js";
import { html } from "lit";
import { createRef, ref } from "lit/directives/ref.js";

import { registerMdiIcons } from "../../../util/register-icons.js";
import type { ESPHomeConfirmDialog } from "../../confirm-dialog.js";
import "../../confirm-dialog.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ delete: mdiDelete });

export function renderDeleteRow(opts: {
  label: string;
  message: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const dialog = createRef<ESPHomeConfirmDialog>();
  return html`<div class="ae-actions">
      <button
        type="button"
        class="ae-danger"
        ?disabled=${opts.disabled}
        @click=${() => dialog.value?.open()}
      >
        <wa-icon library="mdi" name="delete"></wa-icon>
        ${opts.label}
      </button>
    </div>
    <esphome-confirm-dialog
      ${ref(dialog)}
      heading=${opts.label}
      confirm-label=${opts.label}
      message=${opts.message}
      destructive
      @confirm=${opts.onConfirm}
    ></esphome-confirm-dialog>`;
}
