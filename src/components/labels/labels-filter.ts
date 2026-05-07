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
import { customElement, property, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../../api/esphome-api.js";
import type { Label } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, labelsContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { EscapeController } from "../../util/escape-controller.js";
import {
  labelChipStyles,
} from "../../util/label-chip-template.js";
import { deleteConfirmKey } from "../../util/label-usage.js";
import { labelChipStyleString } from "../../util/label-style.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import "./label-form.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
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

  @consume({ context: apiContext })
  @state()
  private _api?: ESPHomeAPI;

  /** Currently-selected label ids. Source of truth lives on the
   *  parent (dashboard) so we don't drift with router state /
   *  query-string serialization later. */
  @property({ attribute: false })
  selected: string[] = [];

  /** Per-label-id device count, fed from the dashboard which
   *  already iterates the device list for filtering. Powers the
   *  "this will remove the label from N devices" copy in the
   *  delete-confirm dialog. Missing entries are treated as zero —
   *  no warning if the label happens to be unused. */
  @property({ attribute: false })
  labelUsage: Record<string, number> = {};

  @state()
  private _open = false;

  /** When non-null, the popover swaps from list mode to a single
   *  edit form for this label. Cleared on save / cancel / close. */
  @state()
  private _editing: Label | null = null;

  /** When non-null, a delete-confirm dialog is showing for this
   *  label. The dialog stays mounted while in flight; cleared on
   *  confirm / cancel / completion. */
  @state()
  private _pendingDelete: Label | null = null;

  /** ``true`` while the delete API call is in flight. Disables the
   *  confirm button so a double-click can't fire two deletes. */
  @state()
  private _deleting = false;

  /** Snapshot of ``_editing.id`` taken when the form fires
   *  ``submitting``. Used to drop a stale ``label-saved`` event
   *  that resolves after the user has already navigated to a
   *  different edit target — without this, the late event would
   *  set ``_editing = null`` and kick the user out of the new
   *  session. ``null`` means "no edit save in flight". */
  private _pendingSaveFor: string | null = null;

  @query("wa-dialog")
  private _deleteDialog?: HTMLElement & { hide: () => Promise<void> };

  private _escape = new EscapeController(this, (e) => {
    e.preventDefault();
    // Escape unwinds one level at a time: confirm → edit → close.
    // Lets the user back out of a nested action without losing
    // their place in the list.
    if (this._pendingDelete) {
      void this._dismissDeleteDialog();
      return;
    }
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

      .delete-confirm-body {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-normal);
        line-height: 1.5;
      }

      .delete-confirm-actions {
        display: flex;
        gap: var(--wa-space-xs);
        justify-content: flex-end;
        margin-top: var(--wa-space-m);
      }

      .delete-btn {
        padding: 6px 14px;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        border-radius: var(--wa-border-radius-s);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: var(--wa-color-surface-default);
        color: var(--wa-color-text-normal);
        cursor: pointer;
        font-family: inherit;
      }

      .delete-btn--danger {
        background: var(--wa-color-danger-fill-loud);
        color: var(--wa-color-danger-on-loud);
        border-color: var(--wa-color-danger-fill-loud);
      }

      .delete-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
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
    if (changed.has("_catalog")) {
      // A push event from another client (or this one) may have
      // dropped the label the user is currently editing or about to
      // delete. Without this guard the form sits with a ``Label``
      // that no longer exists, save would 404, and the delete
      // confirm would warn about removing a label that's already
      // gone. Bail out cleanly to the list mode instead.
      if (this._editing && !this._catalog.some((l) => l.id === this._editing!.id)) {
        this._editing = null;
        this._pendingSaveFor = null;
      }
      if (
        this._pendingDelete &&
        !this._catalog.some((l) => l.id === this._pendingDelete!.id)
      ) {
        this._pendingDelete = null;
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
    // wa-dialog portals into document.body on open; a click on its
    // backdrop / cancel / delete buttons doesn't appear inside our
    // shadow root, so the default "click outside" check would
    // close the popover behind the dialog. Guard the popover-close
    // for as long as the delete-confirm is showing — Escape /
    // wa-after-hide / the dialog buttons all clear ``_pendingDelete``
    // first, so this only suppresses the close while the dialog is
    // genuinely active.
    if (this._pendingDelete) return;
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
      ${/* Render the delete-confirm dialog at the trigger level
            (outside the popover-conditional) so an in-flight
            ``deleteLabel`` survives the user closing the popover —
            wa-dialog portals into document.body either way, but
            unmounting it mid-flight would leave the user with no
            way to see a failure toast or know whether the request
            had completed. */ ""}
      ${this._renderDeleteDialog()}
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
                    this._pendingDelete = label;
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
        @submitting=${this._onSaveSubmitting}
        @label-saved=${this._onLabelSaved}
        @editing-cancel=${this._exitEditMode}
      ></esphome-label-form>
    `;
  }

  private _renderDeleteDialog() {
    const target = this._pendingDelete;
    if (!target) return nothing;
    const usage = this.labelUsage[target.id] ?? 0;
    const messageKey = deleteConfirmKey(usage);
    return html`
      <wa-dialog
        open
        light-dismiss
        label=${this._localize("dashboard.labels_delete_title")}
        @wa-after-hide=${() => {
          // Don't drop ``_pendingDelete`` while the request is in
          // flight — the dialog will re-render itself open if the
          // call fails so the user can see the toast and retry.
          if (!this._deleting) this._pendingDelete = null;
        }}
      >
        <div class="delete-confirm-body">
          ${this._localize(messageKey, { name: target.name, count: usage })}
        </div>
        <div class="delete-confirm-actions">
          <button
            type="button"
            class="delete-btn"
            ?disabled=${this._deleting}
            @click=${() => void this._dismissDeleteDialog()}
          >
            ${this._localize("dashboard.labels_create_cancel")}
          </button>
          <button
            type="button"
            class="delete-btn delete-btn--danger"
            ?disabled=${this._deleting}
            @click=${() => void this._confirmDelete(target)}
          >
            ${this._localize("dashboard.labels_delete_submit")}
          </button>
        </div>
      </wa-dialog>
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

  /** Snapshot the label the user just clicked Save on so a stale
   *  ``label-saved`` event resolving after the user has already
   *  navigated away can't flip the popover out of a fresh edit
   *  session for a different label. Same shape as the editor's
   *  device-swap race fix. */
  private _onSaveSubmitting = () => {
    this._pendingSaveFor = this._editing?.id ?? null;
  };

  private _onLabelSaved = (e: CustomEvent<Label>) => {
    const expected = this._pendingSaveFor;
    this._pendingSaveFor = null;
    // Drop late events from a previous edit session — the form
    // bubbles ``label-saved`` whenever its ``updateLabel`` resolves,
    // and a user who clicked Save → Back → opened a different
    // label's edit form would otherwise be kicked out of the new
    // session by the in-flight previous one. We also drop the
    // event when ``_editing`` no longer matches the saved label
    // (e.g. user backed out manually before the round trip
    // returned).
    if (expected !== e.detail.id) return;
    if (this._editing?.id !== e.detail.id) return;
    // The form already round-tripped to ``labels/update`` and the
    // backend's ``LABEL_UPDATED`` push will refresh the catalog
    // through the labelsContext. Just return the popover to list
    // mode so the user sees their renamed chip in the list.
    this._editing = null;
  };

  private _exitEditMode = () => {
    this._editing = null;
    this._pendingSaveFor = null;
  };

  /** Hide the delete dialog through wa-dialog's own close path so
   *  the hide animation plays. ``wa-after-hide`` clears
   *  ``_pendingDelete`` once the animation finishes. Falls back to
   *  the synchronous state clear if the dialog isn't mounted (e.g.
   *  Escape fired before the first render). */
  private async _dismissDeleteDialog() {
    if (this._deleteDialog) {
      await this._deleteDialog.hide();
      return;
    }
    this._pendingDelete = null;
  }

  private async _confirmDelete(label: Label) {
    if (!this._api || this._deleting) return;
    this._deleting = true;
    try {
      await this._api.deleteLabel(label.id);
      // Drop the deleted id from the active filter selection so a
      // stale chip doesn't outlive the catalog entry — the
      // alternative (silently keeping the id) leaves the filter
      // matching nothing with no visible explanation.
      if (this.selected.includes(label.id)) {
        this._emit(this.selected.filter((id) => id !== label.id));
      }
      this._pendingDelete = null;
    } catch (err) {
      console.warn("label delete failed", err);
      toast.error(this._localize("dashboard.labels_delete_failed"), {
        richColors: true,
      });
    } finally {
      this._deleting = false;
    }
  }

  private _toggle = () => {
    this._open = !this._open;
  };

  private _close() {
    if (!this._open) return;
    this._open = false;
    // Reset transient sub-views so a subsequent re-open shows the
    // catalog list. Without this, closing the popover via the
    // trigger button while a delete-confirm or edit form was
    // active would leave that state set, and the next open would
    // reopen the dialog / edit form instead of the list — which is
    // never what the user expects after explicitly closing.
    this._editing = null;
    this._pendingSaveFor = null;
    if (this._pendingDelete && !this._deleting) {
      this._pendingDelete = null;
    }
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
