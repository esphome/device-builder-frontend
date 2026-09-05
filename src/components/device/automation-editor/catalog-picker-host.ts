import { css, html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";

import type {
  AutomationAction,
  AutomationCondition,
  AvailableComponentInstance,
} from "../../../api/types/automations.js";
import "./catalog-picker-dialog.js";
import type {
  CatalogPickedDetail,
  ESPHomeCatalogPickerDialog,
} from "./catalog-picker-dialog.js";

/** What a nested editor asks the shared picker to show, and who gets the pick. */
export interface CatalogPickRequest {
  kind: "action" | "condition";
  items: AutomationAction[] | AutomationCondition[];
  devices: AvailableComponentInstance[];
  onPicked(detail: CatalogPickedDetail): void;
}

/** Ask the nearest ``esphome-catalog-picker-host`` above *from* to open its picker. */
export function requestCatalogPick(from: HTMLElement, request: CatalogPickRequest): void {
  from.dispatchEvent(
    new CustomEvent<CatalogPickRequest>("request-catalog-pick", {
      detail: request,
      bubbles: true,
      composed: true,
    })
  );
}

/**
 * One picker for a whole editor tree. Action lists, action nodes and
 * condition trees request a pick instead of each mounting a dialog, so a
 * long automation carries one picker, not one per row.
 */
@customElement("esphome-catalog-picker-host")
export class ESPHomeCatalogPickerHost extends LitElement {
  @state() private _request: CatalogPickRequest | null = null;

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
    const request = this._request;
    return html`<slot></slot>
      <esphome-catalog-picker-dialog
        kind=${request?.kind ?? "action"}
        .items=${request?.items ?? []}
        .devices=${request?.devices ?? []}
        @catalog-picked=${this._onPicked}
      ></esphome-catalog-picker-dialog>`;
  }

  private _onRequest = (e: Event) => {
    e.stopPropagation();
    this._request = (e as CustomEvent<CatalogPickRequest>).detail;
    // The picker reads the request through its bindings; open after they land.
    void this.updateComplete.then(() => this._picker.open());
  };

  private _onPicked = (e: CustomEvent<CatalogPickedDetail>) => {
    e.stopPropagation();
    this._request?.onPicked(e.detail);
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-catalog-picker-host": ESPHomeCatalogPickerHost;
  }
}
