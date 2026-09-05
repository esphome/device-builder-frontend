import { css, html, LitElement } from "lit";
import { customElement, query } from "lit/decorators.js";

import { fireRequestEvent } from "../../../util/fire-event.js";
import "./catalog-picker-dialog.js";
import type {
  CatalogPickRequest,
  ESPHomeCatalogPickerDialog,
} from "./catalog-picker-dialog.js";

export type { CatalogPickRequest } from "./catalog-picker-dialog.js";

/** Ask the nearest ``esphome-catalog-picker-host`` above *from* to open its
 *  picker; warns when no host answers, since the button is otherwise dead. */
export function requestCatalogPick(from: HTMLElement, request: CatalogPickRequest): void {
  if (!fireRequestEvent(from, "request-catalog-pick", request)) {
    console.warn("request-catalog-pick found no esphome-catalog-picker-host above", from);
  }
}

/**
 * One picker for a whole editor tree. Action lists, action nodes and
 * condition trees request a pick instead of each mounting a dialog, so a
 * long automation carries one picker, not one per row. A pick lands on the
 * requester's callback even if its row has since been removed.
 */
@customElement("esphome-catalog-picker-host")
export class ESPHomeCatalogPickerHost extends LitElement {
  @query("esphome-catalog-picker-dialog")
  private _picker!: ESPHomeCatalogPickerDialog;

  static styles = css`
    :host {
      display: contents;
    }
  `;

  override connectedCallback() {
    super.connectedCallback();
    this.addEventListener("request-catalog-pick", this._onRequest);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("request-catalog-pick", this._onRequest);
  }

  protected render() {
    return html`<slot></slot>
      <esphome-catalog-picker-dialog></esphome-catalog-picker-dialog>`;
  }

  private _onRequest = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    this._picker.open((e as CustomEvent<CatalogPickRequest>).detail);
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-catalog-picker-host": ESPHomeCatalogPickerHost;
  }
}
