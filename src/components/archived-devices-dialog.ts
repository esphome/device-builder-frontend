import { consume } from "@lit/context";
import { mdiArchiveArrowUpOutline, mdiArchiveOutline, mdiTrashCanOutline } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { ArchivedDevice } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./base-dialog.js";

registerMdiIcons({
  "archive-arrow-up-outline": mdiArchiveArrowUpOutline,
  "archive-outline": mdiArchiveOutline,
  "trash-can-outline": mdiTrashCanOutline,
});

/**
 * Modal listing archived (soft-deleted) devices.
 *
 * Lives behind a header-kebab "Archived devices" entry rather than
 * inline on the dashboard. Archived devices are an infrequent
 * concern — keeping them out of the main flow avoids competing
 * with the active list for vertical space and sidesteps scroll /
 * overflow issues on long archive lists.
 *
 * Responsibilities:
 *   * Pull the list off ``devices/list_archived`` on every open.
 *     The archive directory is on-disk state, not WS-event-driven,
 *     so this is the cheapest way to keep the dialog fresh.
 *   * Per-row Unarchive button — fires ``unarchive`` event with the
 *     ArchivedDevice. Caller restores via the WS API and signals
 *     us back to refresh / close.
 *   * Per-row Delete-permanently button — fires ``delete-archived``
 *     event so the dashboard can route through its existing
 *     confirm-dialog instance (we don't duplicate the dialog here).
 *   * Empty state when no archives — same dialog opens but tells
 *     the user there's nothing to restore. Keeps the menu entry
 *     always-visible without forcing a count-bridge plumbing.
 */
@customElement("esphome-archived-devices-dialog")
export class ESPHomeArchivedDevicesDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext, subscribe: true })
  @state()
  private _api?: ESPHomeAPI;

  @state() private _devices: ArchivedDevice[] = [];
  @state() private _loading = false;
  @state() private _error: string | null = null;
  @state() private _open = false;

  static styles = [
    espHomeStyles,
    css`
      esphome-base-dialog {
        --width: 560px;
      }

      /* Cap the dialog short of the viewport edges so toasts that
         render bottom-right (sonner-js, ~24px gap + ~80px height)
         aren't covered by a long archive list. The dialog body
         itself scrolls (see the .body rule below) so the visible
         chrome (header / desc / footer) always fits in the
         remaining space. */
      esphome-base-dialog::part(dialog) {
        max-block-size: calc(100vh - 160px);
      }

      esphome-base-dialog::part(header) {
        padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-s);
      }

      esphome-base-dialog::part(title) {
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      esphome-base-dialog::part(body) {
        padding: 0;
      }

      esphome-base-dialog::part(footer) {
        display: none;
      }

      .body {
        /* Subtract the dialog's own chrome (header ~60px, desc/padding
           ~80px, action footer ~76px) from the dialog max-height
           so the rows scroll inside the body instead of pushing the
           dialog past its viewport cap. */
        max-height: calc(100vh - 380px);
        overflow-y: auto;
        padding: 0 var(--wa-space-l) var(--wa-space-m);
      }

      .desc {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
        margin-bottom: var(--wa-space-m);
      }

      .row {
        display: flex;
        align-items: center;
        gap: var(--wa-space-m);
        padding: var(--wa-space-s) 0;
        border-top: 1px solid var(--wa-color-neutral-fill-quiet);
      }

      .row:last-of-type {
        border-bottom: 1px solid var(--wa-color-neutral-fill-quiet);
      }

      .row-info {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .row-name {
        color: var(--wa-color-text-normal);
        font-weight: var(--wa-font-weight-bold);
        font-size: var(--wa-font-size-m);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .row-config {
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-2xs);
        font-family: var(--wa-font-family-code);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .row-comment {
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-xs);
        font-style: italic;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .row-actions {
        display: flex;
        gap: var(--wa-space-xs);
        flex-shrink: 0;
      }

      .row-btn {
        background: transparent;
        border: 1px solid var(--wa-color-neutral-fill-loud);
        border-radius: var(--wa-border-radius-m);
        padding: var(--wa-space-2xs) var(--wa-space-s);
        color: var(--wa-color-text-normal);
        font-size: var(--wa-font-size-2xs);
        font-family: inherit;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: var(--wa-space-2xs);
      }

      .row-btn:hover {
        background: var(--wa-color-neutral-fill-quiet);
      }

      .row-btn:focus-visible {
        outline: 2px solid var(--esphome-primary-light);
        outline-offset: 2px;
      }

      .row-btn--danger {
        color: var(--wa-color-danger-text-normal);
        border-color: var(--wa-color-danger-fill-loud);
      }

      .row-btn--danger:hover {
        background: var(--wa-color-danger-fill-quiet);
      }

      .empty,
      .loading,
      .error {
        padding: var(--wa-space-2xl) var(--wa-space-l);
        text-align: center;
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
      }

      .error {
        color: var(--wa-color-danger-text-normal);
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        padding: var(--wa-space-m) var(--wa-space-l) var(--wa-space-l);
      }

      .btn {
        padding: 8px 18px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: none;
      }

      .btn--cancel {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .btn--cancel:hover {
        background: var(--wa-color-surface-border);
      }
    `,
  ];

  /** Open the dialog and (re)fetch the archive list. */
  async open() {
    this._open = true;
    await this.refresh();
  }

  close() {
    this._open = false;
  }

  private _onAfterHide = (): void => {
    // <esphome-base-dialog> re-emits after-hide for every
    // dismissal path (Esc / outside-click / X / reactive
    // ?open flip). Flip our local open flag so the next
    // render's ?open binding matches.
    this._open = false;
  };

  /** Re-pull the list. Caller invokes after unarchive / delete to
   *  reflect the new state without closing the dialog. */
  async refresh() {
    if (!this._api) return;
    this._loading = true;
    this._error = null;
    try {
      this._devices = await this._api.listArchivedDevices();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._error = msg;
      this._devices = [];
    } finally {
      this._loading = false;
    }
  }

  protected render() {
    return html`
      <esphome-base-dialog
        ?open=${this._open}
        .label=${this._localize("dashboard.archived_dialog_title")}
        @after-hide=${this._onAfterHide}
      >
        <div class="body">
          <p class="desc">${this._localize("dashboard.archived_dialog_desc")}</p>
          ${this._renderBody()}
        </div>
        <div class="actions">
          <button class="btn btn--cancel" @click=${this.close}>
            ${this._localize("dashboard.archived_dialog_close")}
          </button>
        </div>
      </esphome-base-dialog>
    `;
  }

  private _renderBody() {
    if (this._loading && this._devices.length === 0) {
      return html`<div class="loading">
        ${this._localize("dashboard.archived_dialog_loading")}
      </div>`;
    }
    if (this._error) {
      return html`<div class="error">${this._error}</div>`;
    }
    if (this._devices.length === 0) {
      return html`<div class="empty">
        ${this._localize("dashboard.archived_dialog_empty")}
      </div>`;
    }
    return html`
      ${this._devices.map(
        (device) => html`
          <div class="row">
            <div class="row-info">
              <div class="row-name">${device.friendly_name || device.name}</div>
              <div class="row-config">${device.configuration}</div>
              ${device.comment
                ? html`<div class="row-comment">${device.comment}</div>`
                : nothing}
            </div>
            <div class="row-actions">
              <button
                class="row-btn"
                type="button"
                @click=${() => this._unarchive(device)}
              >
                <wa-icon library="mdi" name="archive-arrow-up-outline"></wa-icon>
                ${this._localize("dashboard.action_unarchive")}
              </button>
              <button
                class="row-btn row-btn--danger"
                type="button"
                @click=${() => this._deletePermanently(device)}
              >
                <wa-icon library="mdi" name="trash-can-outline"></wa-icon>
                ${this._localize("dashboard.action_delete_permanently")}
              </button>
            </div>
          </div>
        `
      )}
    `;
  }

  private _unarchive(device: ArchivedDevice) {
    this.dispatchEvent(
      new CustomEvent("unarchive", {
        detail: device,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _deletePermanently(device: ArchivedDevice) {
    this.dispatchEvent(
      new CustomEvent("delete-archived", {
        detail: device,
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-archived-devices-dialog": ESPHomeArchivedDevicesDialog;
  }
}
