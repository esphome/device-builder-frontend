import { consume } from "@lit/context";
import { mdiArrowLeft, mdiClose } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ComponentCatalogEntry } from "../../api/types.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext, apiContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "./component-catalog.js";
import "./add-component-form.js";
import type { ESPHomeComponentCatalog } from "./component-catalog.js";

registerMdiIcons({ close: mdiClose, "arrow-left": mdiArrowLeft });

@customElement("esphome-add-component-dialog")
export class ESPHomeAddComponentDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property()
  boardName = "";

  @property()
  configuration = "";

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  @query("esphome-component-catalog")
  private _catalog!: ESPHomeComponentCatalog;

  @state()
  private _selected: ComponentCatalogEntry | null = null;

  @state()
  private _submitting = false;

  @state()
  private _submitError = "";

  static styles = [
    espHomeStyles,
    css`
      wa-dialog {
        --width: 900px;
      }

      wa-dialog.form-view {
        --width: 480px;
      }

      wa-dialog::part(header) {
        background: var(--esphome-primary);
        padding: 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }

      wa-dialog::part(title) {
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      wa-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
        padding: 0;
        min-width: unset;
        min-height: unset;
        color: var(--esphome-on-primary);
        cursor: pointer;
      }

      wa-dialog::part(body) {
        padding: var(--wa-space-l);
      }

      wa-dialog::part(footer) {
        display: none;
      }

      .dialog-label {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      .back-button {
        display: inline-flex;
        align-items: center;
        border: none;
        background: none;
        padding: 2px;
        margin-right: var(--wa-space-2xs);
        color: var(--esphome-on-primary);
        cursor: pointer;
        border-radius: 4px;
        opacity: 0.85;
      }

      .back-button:hover {
        opacity: 1;
      }
    `,
  ];

  public open() {
    this._selected = null;
    this._submitError = "";
    this._submitting = false;
    this._dialog.open = true;
    this.updateComplete.then(() => this._catalog?.load());
  }

  protected render() {
    const isForm = this._selected !== null;
    return html`
      <wa-dialog
        class=${isForm ? "form-view" : ""}
        light-dismiss
        @add-component=${this._onComponentSelected}
        @form-cancel=${this._onBack}
        @form-submit=${this._onFormSubmit}
      >
        <span slot="label" class="dialog-label">
          ${isForm
            ? html`<button class="back-button" @click=${this._onBack}>
                <wa-icon library="mdi" name="arrow-left"></wa-icon>
              </button>`
            : nothing}
          ${isForm
            ? this._selected!.name
            : this.boardName
              ? this._localize("device.add_component_dialog_title", { name: this.boardName })
              : this._localize("device.add_component")}
        </span>
        ${isForm
          ? html`<esphome-add-component-form
              .component=${this._selected!}
              .submitting=${this._submitting}
              .submitError=${this._submitError}
            ></esphome-add-component-form>`
          : html`<esphome-component-catalog></esphome-component-catalog>`}
      </wa-dialog>
    `;
  }

  private _onComponentSelected(e: CustomEvent<{ component: ComponentCatalogEntry }>) {
    e.stopPropagation();
    this._selected = e.detail.component;
    this._submitError = "";
  }

  private _onBack() {
    if (this._submitting) return;
    this._selected = null;
    this._submitError = "";
  }

  private async _onFormSubmit(e: CustomEvent<{ fields: Record<string, unknown> }>) {
    e.stopPropagation();
    if (!this._selected || !this.configuration || this._submitting) return;
    this._submitting = true;
    this._submitError = "";
    try {
      const { yaml } = await this._api.addComponent(this.configuration, {
        component_id: this._selected.id,
        fields: e.detail.fields,
      });
      this._dialog.open = false;
      this._selected = null;
      this.dispatchEvent(
        new CustomEvent("yaml-updated", {
          detail: { yaml },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this._submitError = err instanceof Error
        ? err.message
        : this._localize("device.add_component_error");
    } finally {
      this._submitting = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-add-component-dialog": ESPHomeAddComponentDialog;
  }
}
