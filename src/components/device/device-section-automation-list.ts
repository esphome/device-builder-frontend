import { mdiDelete, mdiPencil, mdiPlus } from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { deviceSectionAutomationListStyles } from "./device-section-automation-list.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

// Self-contained icon registration — the component renders these MDI
// icons regardless of which host mounts it.
registerMdiIcons({ plus: mdiPlus, pencil: mdiPencil, delete: mdiDelete });

/** One row in the manage-list: ``key`` is the stable section key (used
 *  for both edit-routing and delete), ``label`` the display text. */
export interface AutomationListRow {
  key: string;
  label: string;
}

/**
 * Inline manage-list shared by the section editor's three automation
 * surfaces — API actions, inline triggers, and component action fields.
 * Purely presentational: it renders the heading, optional "Add" button,
 * and the rows with edit / delete affordances, and emits ``add`` /
 * ``edit`` / ``delete`` events. The host owns the data and the backend
 * round-trips, so the markup + styles live in exactly one place.
 *
 * Rendering rules:
 * - No rows and no ``addLabel`` → renders nothing (an empty, add-less
 *   table is noise; component action fields use this).
 * - No rows but an ``addLabel`` → header + Add button; the empty-state
 *   placeholder shows only when ``emptyText`` is provided (otherwise the
 *   empty region renders nothing — no blank box / ARIA status).
 * - ``busyKey`` non-empty locks every row (one delete in flight at a
 *   time) so a second delete or a mid-flight edit can't race it.
 */
@customElement("esphome-section-automation-list")
export class ESPHomeSectionAutomationList extends LitElement {
  static styles = [espHomeStyles, deviceSectionAutomationListStyles];

  @property()
  heading = "";

  @property({ attribute: false })
  rows: AutomationListRow[] = [];

  /** When set, render the "Add" button; omit for fixed lists. */
  @property({ attribute: "add-label" })
  addLabel?: string;

  /** Placeholder shown when there are no rows (only with an add button). */
  @property({ attribute: "empty-text" })
  emptyText?: string;

  /** Row key currently being deleted; locks the whole list while set. */
  @property({ attribute: "busy-key" })
  busyKey = "";

  @property({ attribute: "edit-label" })
  editLabel = "";

  @property({ attribute: "delete-label" })
  deleteLabel = "";

  protected render() {
    if (this.rows.length === 0 && this.addLabel === undefined) return nothing;
    const locked = this.busyKey !== "";
    return html`<div class="list">
      <div class="header">
        <h4 class="title">${this.heading}</h4>
        ${
          this.addLabel !== undefined
            ? html`<button type="button" class="add" @click=${this._onAdd}>
                <wa-icon library="mdi" name="plus"></wa-icon>
                ${this.addLabel}
              </button>`
            : nothing
        }
      </div>
      ${
        this.rows.length === 0
          ? // Only paint the placeholder when there's copy for it — a blank
            // dashed box + empty ARIA status would just be noise otherwise.
            this.emptyText !== undefined
            ? html`<p class="empty" role="status">${this.emptyText}</p>`
            : nothing
          : html`<ul class="rows">
              ${this.rows.map(
                (row) =>
                  html`<li class="row">
                    <span class="name">${row.label}</span>
                    <div class="row-buttons">
                      <button
                        type="button"
                        class="row-edit"
                        aria-label=${this.editLabel}
                        title=${this.editLabel}
                        ?disabled=${locked}
                        @click=${() => this._emit("edit", row.key)}
                      >
                        <wa-icon library="mdi" name="pencil"></wa-icon>
                      </button>
                      <button
                        type="button"
                        class="row-delete"
                        aria-label=${this.deleteLabel}
                        title=${this.deleteLabel}
                        ?disabled=${locked}
                        @click=${() => this._emit("delete", row.key)}
                      >
                        <wa-icon library="mdi" name="delete"></wa-icon>
                      </button>
                    </div>
                  </li>`
              )}
            </ul>`
      }
    </div>`;
  }

  private _onAdd = () => {
    this.dispatchEvent(new CustomEvent("add", { bubbles: true, composed: true }));
  };

  private _emit(type: "edit" | "delete", key: string) {
    this.dispatchEvent(
      new CustomEvent(type, { detail: { key }, bubbles: true, composed: true })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-section-automation-list": ESPHomeSectionAutomationList;
  }
}
