/**
 * Dashboard-mounted modal hosting ``<esphome-label-form>`` for both
 * creating a label and editing an existing one.
 *
 * Mounted at the dashboard level (not inside the Filters popover)
 * because popover content is unrendered while the popover is
 * closed — a dialog owned by a section would vanish mid-flow. The
 * popover closes first, then this dialog opens; mirrors how delete
 * routes to the dashboard's shared confirm dialog.
 *
 * ``editing`` is the mode switch: ``null`` renders the create form,
 * a ``Label`` renders the pre-filled edit form. ``label-created`` /
 * ``label-saved`` bubble composed out of the form through this host;
 * the dialog re-emits ``after-hide`` (the inner dialog's own event
 * doesn't compose) so the owner can clear its open/editing state on
 * any close path.
 */
import { consume } from "@lit/context";
import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Label } from "../../api/types/devices.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { labelsContext, localizeContext } from "../../context/index.js";
import {
  dialogChromeStyles,
  quietCloseButtonStyles,
} from "../../styles/dialog-chrome.js";
import { espHomeStyles } from "../../styles/shared.js";
import "../base-dialog.js";
import "./label-form.js";

@customElement("esphome-label-dialog")
export class ESPHomeLabelDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: labelsContext, subscribe: true })
  @state()
  private _catalog: Label[] = [];

  /** Reactive open flag — the owner sets it and clears it from the
   *  ``after-hide`` this host re-emits. */
  @property({ type: Boolean }) open = false;

  /** Label to edit, or ``null`` for create mode. */
  @property({ attribute: false })
  editing: Label | null = null;

  static styles = [
    espHomeStyles,
    dialogChromeStyles,
    quietCloseButtonStyles,
    css`
      .label-dialog {
        --width: 460px;
      }

      .label-dialog::part(body) {
        padding: 0 var(--wa-space-l) var(--wa-space-l);
      }
    `,
  ];

  protected willUpdate() {
    // A push event from another client may have dropped the label
    // being edited. Without this guard the form sits with a
    // ``Label`` that no longer exists and save would 404.
    if (
      this.open &&
      this.editing &&
      !this._catalog.some((l) => l.id === this.editing!.id)
    ) {
      this._requestClose();
    }
  }

  protected render() {
    const title = this.editing
      ? this._localize("dashboard.labels_edit_label")
      : this._localize("dashboard.labels_create");
    return html`
      <esphome-base-dialog
        class="label-dialog"
        ?open=${this.open}
        .label=${title}
        @request-close=${this._requestClose}
        @after-hide=${this._onAfterHide}
      >
        <esphome-label-form
          .existingNames=${this._catalog.map((l) => l.name)}
          .editing=${this.editing}
          default-open
          compact
          @editing-cancel=${this._requestClose}
        ></esphome-label-form>
      </esphome-base-dialog>
    `;
  }

  private _requestClose = () => {
    this.dispatchEvent(
      new CustomEvent("request-close", { bubbles: true, composed: true })
    );
  };

  private _onAfterHide = () => {
    this.dispatchEvent(new CustomEvent("after-hide", { bubbles: true, composed: true }));
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-label-dialog": ESPHomeLabelDialog;
  }
}
