/**
 * Filter affordance that narrows the device list to entries
 * carrying every selected label (logical AND).
 *
 * Sits next to the search input in the dashboard toolbar. The
 * trigger renders unconditionally — even on a fleet that hasn't
 * defined any labels yet — because the popover is the discovery
 * path for creating the first label; hiding the button on an
 * empty catalog (the original behaviour) made that affordance
 * unreachable from the dashboard. The component owns no filter
 * state itself — selections live on the parent dashboard so the
 * device-filter logic, the URL query string, and the empty-state
 * copy can all read from a single source. Selection changes are
 * emitted as a ``labels-filter-change`` ``CustomEvent<string[]>``
 * carrying the new full set of selected ids.
 */
import { consume } from "@lit/context";
import {
  mdiArrowLeft,
  mdiCheck,
  mdiPencilOutline,
  mdiTagMultipleOutline,
  mdiTrashCanOutline,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Label } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { labelsContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { EscapeController } from "../../util/escape-controller.js";
import {
  labelChipStyles,
} from "../../util/label-chip-template.js";
import { labelChipStyleString } from "../../util/label-style.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import "./label-form.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "arrow-left": mdiArrowLeft,
  check: mdiCheck,
  "pencil-outline": mdiPencilOutline,
  "tag-multiple-outline": mdiTagMultipleOutline,
  "trash-can-outline": mdiTrashCanOutline,
});

@customElement("esphome-labels-filter")
export class ESPHomeLabelsFilter extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: labelsContext, subscribe: true })
  @state()
  private _catalog: Label[] = [];

  /** Currently-selected label ids. Source of truth lives on the
   *  parent (dashboard) so we don't drift with router state /
   *  query-string serialization later. */
  @property({ attribute: false })
  selected: string[] = [];

  @state()
  private _open = false;

  /** When non-null, the popover swaps from list mode to a single
   *  edit form for this label. Cleared on save / cancel / close. */
  @state()
  private _editing: Label | null = null;

  private _escape = new EscapeController(this, (e) => {
    e.preventDefault();
    // Escape unwinds one level at a time: edit → close. The
    // delete-confirm dialog isn't mounted by us — the dashboard
    // owns it via the shared ``<esphome-confirm-dialog>`` — so
    // its own light-dismiss / Escape handler closes it without
    // our help.
    if (this._editing) {
      this._editing = null;
      return;
    }
    this._close();
  });

  static styles = [
    espHomeStyles,
    labelChipStyles,
    css`
      :host {
        display: inline-block;
        position: relative;
      }

      /* Match the dashboard's other icon-button affordances
         ('select-toggle-btn' + segmented 'view-toggle-btn'): 36px
         square, neutral fill, primary fill when active. The active
         count rides as a small badge in the upper-right corner so
         the button stays icon-sized at any selection count. */
      .trigger {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: var(--wa-border-radius-m);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: var(--wa-color-surface-raised);
        color: var(--wa-color-text-quiet);
        cursor: pointer;
        transition:
          background 0.12s,
          color 0.12s,
          border-color 0.12s;
        padding: 0;
        flex-shrink: 0;
      }

      .trigger:hover {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
      }

      .trigger--active {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
        border-color: var(--esphome-primary);
      }

      .trigger--active:hover {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
      }

      .trigger wa-icon {
        font-size: 18px;
      }

      .count-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 16px;
        height: 16px;
        padding: 0 4px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: var(--wa-font-weight-bold);
        line-height: 1;
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
        border: 2px solid var(--wa-color-surface-default);
      }

      /* When the button itself is filled (active state), the badge
         needs the inverse outline to stay distinct. */
      .trigger--active .count-badge {
        background: var(--wa-color-surface-default);
        color: var(--esphome-primary);
        border-color: var(--esphome-primary);
      }

      /* The trigger sits in the right-hand cluster of the dashboard
         toolbar, so anchoring the popover to the trigger's right
         edge keeps it inside the viewport — anchoring to the left
         edge made the popover extend off the right side of the
         screen. */
      .popover {
        position: absolute;
        z-index: 10;
        top: calc(100% + 4px);
        right: 0;
        /* Both bounds clamp to the viewport: on a phone-narrow
           layout calc(100vw - 32px) can drop below the desired
           240px floor, so a fixed min-width would force overflow.
           Using min() lets the floor relax when the viewport is
           tight, while the max-width keeps the upper bound. */
        min-width: min(240px, calc(100vw - 32px));
        max-width: min(320px, calc(100vw - 32px));
        background: var(--wa-color-surface-default);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        box-shadow: var(--wa-shadow-m);
        padding: var(--wa-space-xs);
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 320px;
        overflow-y: auto;
      }

      /* Row wrapper holds the option-button + the per-row action
         icons (rename / delete). The action icons stay tucked away
         until the row is hovered or focused so the popover reads
         as a quiet checkbox list at rest. */
      .row {
        display: flex;
        align-items: center;
        gap: 2px;
        border-radius: var(--wa-border-radius-s);
      }

      .row:hover,
      .row:focus-within {
        background: var(--wa-color-surface-lowered);
      }

      .option {
        display: flex;
        flex: 1;
        min-width: 0;
        align-items: center;
        gap: 8px;
        padding: 4px 6px;
        border: none;
        background: transparent;
        text-align: left;
        border-radius: var(--wa-border-radius-s);
        cursor: pointer;
        color: inherit;
      }

      .row-actions {
        display: flex;
        align-items: center;
        gap: 0;
        opacity: 0;
        transition: opacity 0.12s;
        padding-right: 2px;
      }

      .row:hover .row-actions,
      .row:focus-within .row-actions {
        opacity: 1;
      }

      /* On hoverless inputs (touchscreens) the per-row actions
         would otherwise be unreachable — there's no hover to
         reveal them, and a tap fires the option button (toggling
         selection) before :focus-within would settle. Keep them
         visible on those viewports so rename / delete stay usable
         on mobile. The desktop UX (quiet rows at rest) is
         preserved on devices that report hover support. */
      @media (hover: none) {
        .row-actions {
          opacity: 1;
        }
      }

      .row-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: var(--wa-border-radius-s);
        border: none;
        background: transparent;
        color: var(--wa-color-text-quiet);
        cursor: pointer;
        padding: 0;
      }

      .row-action:hover {
        background: var(--wa-color-surface-default);
        color: var(--wa-color-text-normal);
      }

      .row-action:focus-visible {
        outline: 2px solid var(--esphome-primary);
        outline-offset: 1px;
        opacity: 1;
        color: var(--wa-color-text-normal);
      }

      .row-action--danger:hover {
        color: var(--wa-color-danger-fill-loud);
      }

      .row-action wa-icon {
        font-size: 14px;
      }

      /* Edit-mode header: small back arrow + label so the popover
         doesn't lose context when the catalog list is hidden. */
      .edit-header {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        padding: 2px 4px;
      }

      .edit-back {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: var(--wa-border-radius-s);
        border: none;
        background: transparent;
        color: var(--wa-color-text-quiet);
        cursor: pointer;
        padding: 0;
      }

      .edit-back:hover {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
      }

      .edit-back wa-icon {
        font-size: 16px;
      }

      .edit-title {
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
      }

      .option-check {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border-radius: 4px;
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        flex-shrink: 0;
        color: var(--esphome-on-primary);
      }

      .option-check--checked {
        background: var(--esphome-primary);
        border-color: var(--esphome-primary);
      }

      .option-check wa-icon {
        font-size: 12px;
      }

      .clear {
        padding: 4px 6px;
        border: none;
        background: transparent;
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--esphome-primary);
        cursor: pointer;
        border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        margin-top: 4px;
        text-align: left;
      }

      .empty {
        text-align: center;
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        padding: var(--wa-space-s);
      }

      /* Divider between the catalog list / empty hint and the
         "Create new label" affordance. Matches the .clear button's
         border-top treatment so the popover reads as a vertical
         stack of distinct sections. */
      .divider {
        height: 1px;
        background: var(--wa-color-surface-border);
        margin: 4px 0;
      }
    `,
  ];

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has("_open")) this._escape.set(this._open);
    if (changed.has("_catalog") && this._editing) {
      // A push event from another client (or this one) may have
      // dropped the label the user is currently editing. Without
      // this guard the form sits with a ``Label`` that no longer
      // exists and save would 404. Bail out cleanly to list mode.
      if (!this._catalog.some((l) => l.id === this._editing!.id)) {
        this._editing = null;
      }
    }
  }

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click", this._onDocumentClick, true);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this._onDocumentClick, true);
  }

  private _onDocumentClick = (e: MouseEvent) => {
    if (!this._open) return;
    if (e.composedPath().includes(this)) return;
    this._close();
  };

  protected render() {
    // Render the trigger unconditionally — even with an empty
    // catalog, the popover is the path to creating the first
    // label, so hiding the button entirely would leave that
    // affordance undiscoverable.
    const selectedSet = new Set(this.selected);
    const count = this.selected.length;
    const label = this._localize("dashboard.filter_labels");
    return html`
      <button
        class="trigger ${count > 0 ? "trigger--active" : ""}"
        type="button"
        title=${label}
        aria-label=${label}
        aria-haspopup="true"
        aria-expanded=${this._open ? "true" : "false"}
        @click=${this._toggle}
      >
        <wa-icon library="mdi" name="tag-multiple-outline"></wa-icon>
        ${count > 0
          ? html`<span class="count-badge" aria-hidden="true">${count}</span>`
          : nothing}
      </button>
      ${this._open ? this._renderPopover(selectedSet) : nothing}
    `;
  }

  private _renderPopover(selectedSet: Set<string>) {
    return html`
      <div
        class="popover"
        role="group"
        aria-label=${this._localize("dashboard.filter_labels")}
      >
        ${this._editing
          ? this._renderEditMode(this._editing)
          : this._renderListMode(selectedSet)}
      </div>
    `;
  }

  private _renderListMode(selectedSet: Set<string>) {
    const isEmpty = this._catalog.length === 0;
    return html`
      ${isEmpty
        ? html`<div class="empty">
            ${this._localize("dashboard.labels_dialog_empty")}
          </div>`
        : this._catalog.map((label) => {
            const checked = selectedSet.has(label.id);
            return html`<div class="row">
              <button
                class="option"
                type="button"
                role="checkbox"
                aria-checked=${checked ? "true" : "false"}
                @click=${() => this._toggleLabel(label.id, !checked)}
              >
                <span class="option-check ${checked ? "option-check--checked" : ""}">
                  ${checked
                    ? html`<wa-icon library="mdi" name="check"></wa-icon>`
                    : nothing}
                </span>
                <span class="label-chip" style=${labelChipStyleString(label.color)}
                  >${label.name}</span
                >
              </button>
              <div class="row-actions">
                <button
                  class="row-action"
                  type="button"
                  aria-label=${this._localize("dashboard.labels_rename")}
                  title=${this._localize("dashboard.labels_rename")}
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this._editing = label;
                  }}
                >
                  <wa-icon library="mdi" name="pencil-outline"></wa-icon>
                </button>
                <button
                  class="row-action row-action--danger"
                  type="button"
                  aria-label=${this._localize("dashboard.labels_delete")}
                  title=${this._localize("dashboard.labels_delete")}
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    // The actual confirm dialog + delete round
                    // trip lives on the dashboard page, which
                    // already owns one ``<esphome-confirm-dialog>``
                    // instance shared across every destructive
                    // action. Close the popover before bubbling
                    // the request so the dashboard's confirm
                    // dialog (which portals into ``document.body``
                    // and would otherwise be "outside" us under
                    // the document-click guard) doesn't trigger
                    // the popover-close path on its first
                    // interaction. Closing up front keeps the
                    // dashboard view stable behind the dialog and
                    // matches how the other destructive actions
                    // (kebab Delete, bulk Delete, …) behave.
                    this._close();
                    this.dispatchEvent(
                      new CustomEvent<Label>("request-delete-label", {
                        detail: label,
                        bubbles: true,
                        composed: true,
                      }),
                    );
                  }}
                >
                  <wa-icon library="mdi" name="trash-can-outline"></wa-icon>
                </button>
              </div>
            </div>`;
          })}
      ${this.selected.length > 0
        ? html`<button class="clear" type="button" @click=${this._clear}>
            ${this._localize("dashboard.filter_clear")}
          </button>`
        : nothing}
      <div class="divider"></div>
      <esphome-label-form
        .existingNames=${this._catalog.map((l) => l.name)}
        ?default-open=${isEmpty}
        compact
        @label-created=${this._onLabelCreated}
      ></esphome-label-form>
    `;
  }

  private _renderEditMode(label: Label) {
    return html`
      <div class="edit-header">
        <button
          class="edit-back"
          type="button"
          aria-label=${this._localize("dashboard.labels_back")}
          title=${this._localize("dashboard.labels_back")}
          @click=${this._exitEditMode}
        >
          <wa-icon library="mdi" name="arrow-left"></wa-icon>
        </button>
        <span class="edit-title"
          >${this._localize("dashboard.labels_edit_label")}</span
        >
      </div>
      <esphome-label-form
        .existingNames=${this._catalog.map((l) => l.name)}
        .editing=${label}
        compact
        @label-saved=${this._onLabelSaved}
        @editing-cancel=${this._exitEditMode}
      ></esphome-label-form>
    `;
  }

  private _onLabelCreated = (e: CustomEvent<Label>) => {
    // Auto-select the freshly-minted label so the filter is
    // immediately useful — a user who just typed a name and hit
    // Create clearly intends to filter by it.
    const id = e.detail.id;
    if (this.selected.includes(id)) return;
    this._emit([...this.selected, id]);
  };

  private _onLabelSaved = (e: CustomEvent<Label>) => {
    // Drop late events that don't match the current edit target.
    // Toggling between list and edit mode replaces the form
    // element entirely (different conditional branches in the
    // popover render), so a detached form's resolution event
    // doesn't reach us in normal use — but if a future refactor
    // collapses the two branches into a single reused form, this
    // ``_editing.id`` check still keeps a stale resolution from
    // kicking the user out of a fresh edit session.
    if (this._editing?.id !== e.detail.id) return;
    // ``LABEL_UPDATED`` push refreshes the catalog through the
    // labelsContext; just return the popover to list mode so the
    // user sees their renamed chip in the list.
    this._editing = null;
  };

  private _exitEditMode = () => {
    this._editing = null;
  };

  private _toggle = () => {
    this._open = !this._open;
  };

  private _close() {
    if (!this._open) return;
    this._open = false;
    // Reset to the list mode so a subsequent re-open shows the
    // catalog rather than dropping the user back into a partial
    // edit session they explicitly closed away from.
    this._editing = null;
  }

  private _emit(next: string[]) {
    this.dispatchEvent(
      new CustomEvent<string[]>("labels-filter-change", {
        detail: next,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _toggleLabel(labelId: string, select: boolean) {
    if (select) {
      if (this.selected.includes(labelId)) return;
      this._emit([...this.selected, labelId]);
    } else {
      this._emit(this.selected.filter((id) => id !== labelId));
    }
  }

  private _clear = () => {
    this._emit([]);
    this._open = false;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-labels-filter": ESPHomeLabelsFilter;
  }
}
