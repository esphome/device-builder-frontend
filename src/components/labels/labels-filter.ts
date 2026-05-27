/**
 * Filter affordance that narrows the device list to entries
 * carrying every selected label (logical AND).
 *
 * Sits next to the other facet pills in the dashboard toolbar.
 * The trigger renders unconditionally — even on a fleet that
 * hasn't defined any labels yet — because the popover is the
 * discovery path for creating the first label; hiding the
 * affordance on an empty catalog would make label creation
 * unreachable from the dashboard. The component owns no filter
 * state itself — selections live on the parent dashboard so the
 * device-filter logic, the URL query string, and the empty-state
 * copy can all read from a single source. Selection changes are
 * emitted as a ``labels-filter-change`` ``CustomEvent<string[]>``
 * carrying the new full set of selected ids.
 *
 * Visually shares the trigger / popover language with
 * ``<esphome-facet-filter>`` via ``facetStyles`` so the labels
 * pill reads as one of several facet pills in a row.
 */
import { consume } from "@lit/context";
import {
  mdiArrowLeft,
  mdiCheck,
  mdiClose,
  mdiPencilOutline,
  mdiPlus,
  mdiTrashCanOutline,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Label } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { labelsContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { EscapeController } from "../../util/escape-controller.js";
import { labelChipStyles } from "../../util/label-chip-template.js";
import { labelChipStyleString } from "../../util/label-style.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { facetStyles } from "../facets/facet-styles.js";
import "./label-form.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "arrow-left": mdiArrowLeft,
  check: mdiCheck,
  close: mdiClose,
  "pencil-outline": mdiPencilOutline,
  plus: mdiPlus,
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

  /** Per-label assignment counts. Computed by the dashboard from
   *  its devices list (via ``computeLabelUsage``) and passed
   *  through so the popover can show a right-edge count next to
   *  every catalog entry. Missing entries default to ``0``. */
  @property({ attribute: false })
  usageCounts: Record<string, number> = {};

  @state()
  private _open = false;

  /** When non-null, the popover swaps from list mode to a single
   *  edit form for this label. Cleared on save / cancel / close. */
  @state()
  private _editing: Label | null = null;

  /** Drives the standalone "Create label" dialog. Lives outside
   *  the popover so the user can dismiss the popover (or have it
   *  auto-close) without losing the create form mid-edit, and so
   *  the dialog wears the dashboard's modal chrome (focus trap,
   *  light-dismiss, sized title) instead of being crammed inside
   *  a 280-ish-px popover footer. */
  @state()
  private _createOpen = false;

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
    facetStyles,
    labelChipStyles,
    css`
      :host {
        display: inline-block;
        position: relative;
      }

      /* Each catalog row is a button + per-row actions. The
         actions sit absolutely on the right so they overlap the
         count badge at rest and reveal smoothly on hover, keeping
         the visual rhythm aligned with the other facet pills. */
      .row-wrap {
        position: relative;
      }

      .row-wrap .facet-row-count {
        transition: opacity 0.12s ease;
      }

      /* Reveal triggers: mouse hover, or a descendant element that
         has visible (keyboard) focus. :focus-within would also
         match the row button right after a click — clicks leave
         focus on the button, so the actions would stay pinned
         visible after any selection toggle. :has(:focus-visible)
         scopes the reveal to actual keyboard navigation so a mouse
         click on a row doesn't latch the icons on. */
      .row-wrap:hover .facet-row-count,
      .row-wrap:has(:focus-visible) .facet-row-count {
        opacity: 0;
      }

      .row-actions {
        position: absolute;
        top: 50%;
        right: 6px;
        transform: translateY(-50%) translateX(4px);
        display: flex;
        align-items: center;
        gap: 2px;
        opacity: 0;
        pointer-events: none;
        transition:
          opacity 0.15s ease,
          transform 0.15s ease;
      }

      .row-wrap:hover .row-actions,
      .row-wrap:has(:focus-visible) .row-actions {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(-50%) translateX(0);
      }

      /* Touch viewports get the actions pinned visible — there's
         no hover to reveal them and a tap fires the row's
         selection toggle before focus-within can settle. The
         count badge has to hide unconditionally on those
         viewports so the two don't stack on top of each other. */
      @media (hover: none) {
        .row-wrap .facet-row-count {
          opacity: 0;
        }
        .row-actions {
          opacity: 1;
          pointer-events: auto;
          transform: translateY(-50%) translateX(0);
        }
      }

      .row-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: var(--wa-border-radius-m);
        border: var(--wa-border-width-s) solid transparent;
        background: var(--wa-color-surface-default);
        color: var(--wa-color-text-quiet);
        cursor: pointer;
        padding: 0;
        transition:
          background-color 0.12s,
          border-color 0.12s,
          color 0.12s;
      }

      .row-action:hover {
        background: var(--wa-color-surface-raised);
        border-color: var(--wa-color-surface-border);
        color: var(--wa-color-text-normal);
      }

      .row-action:focus-visible {
        outline: none;
        color: var(--wa-color-text-normal);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--esphome-primary), transparent 70%);
      }

      .row-action--danger:hover {
        background: color-mix(in srgb, var(--wa-color-danger-fill-loud), transparent 88%);
        border-color: color-mix(
          in srgb,
          var(--wa-color-danger-fill-loud),
          transparent 70%
        );
        color: var(--wa-color-danger-fill-loud);
      }

      .row-action--danger:focus-visible {
        box-shadow: 0 0 0 2px
          color-mix(in srgb, var(--wa-color-danger-fill-loud), transparent 70%);
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
        padding: 4px 6px 2px;
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

      /* Inline create-form section. Sits below the catalog list
         (or fills the popover when the catalog is empty) and is
         visually separated from the list by a divider so the user
         reads the rows + create form as distinct sections. */
      .create-section {
        border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        padding: var(--wa-space-2xs);
        flex-shrink: 0;
      }

      .create-section--empty {
        border-top: none;
      }

      /* "Create new label" footer button — fills the create section
         and opens the standalone dialog. Reads as a primary call-to-
         action without committing to the loudness of a filled button:
         primary-tinted background, primary text, hover deepens. */
      .create-trigger {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        width: 100%;
        padding: 8px 12px;
        border: var(--wa-border-width-s) solid
          color-mix(in srgb, var(--esphome-primary), transparent 70%);
        border-radius: var(--wa-border-radius-m);
        background: color-mix(in srgb, var(--esphome-primary), transparent 92%);
        color: var(--esphome-primary);
        font-family: inherit;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-semibold, 600);
        cursor: pointer;
        transition:
          background-color 0.12s,
          border-color 0.12s;
      }

      .create-trigger:hover {
        background: color-mix(in srgb, var(--esphome-primary), transparent 85%);
        border-color: color-mix(in srgb, var(--esphome-primary), transparent 50%);
      }

      .create-trigger:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--esphome-primary), transparent 60%);
      }

      .create-trigger wa-icon {
        font-size: 16px;
      }

      /* ─── Standalone create dialog ───────────────────────────── */

      .create-dialog {
        --width: 460px;
      }

      .create-dialog::part(header) {
        padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-s);
      }

      .create-dialog::part(title) {
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .create-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
      }

      .create-dialog::part(body) {
        padding: 0 var(--wa-space-l) var(--wa-space-l);
      }

      .create-dialog::part(footer) {
        display: none;
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
    const active = this.selected.length > 0;
    const name = this._localize("dashboard.filter_labels");
    return html`
      <button
        class="facet-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded=${this._open ? "true" : "false"}
        @click=${this._toggle}
      >
        <span class="facet-trigger-icon" aria-hidden="true">
          <wa-icon library="mdi" name="plus"></wa-icon>
        </span>
        <span class="facet-trigger-name">${name}</span>
        ${active ? this._renderBadges() : nothing}
      </button>
      ${this._open ? this._renderPopover(selectedSet) : nothing}
      ${this._renderCreateDialog()}
    `;
  }

  private _renderCreateDialog() {
    return html`
      <wa-dialog
        class="create-dialog"
        ?open=${this._createOpen}
        light-dismiss
        label=${this._localize("dashboard.labels_create")}
        @wa-after-hide=${this._onCreateDialogHide}
      >
        <esphome-label-form
          .existingNames=${this._catalog.map((l) => l.name)}
          default-open
          compact
          @label-created=${this._onLabelCreated}
          @editing-cancel=${this._closeCreateDialog}
        ></esphome-label-form>
      </wa-dialog>
    `;
  }

  private _openCreateDialog = () => {
    // Close the popover first — keeping it open while the modal
    // dialog floats over it would leave a phantom popover layer
    // peeking around the dialog frame. The user's mental model is
    // "the popover led me to the dialog"; once the dialog is up,
    // the popover has done its job.
    this._close();
    this._createOpen = true;
  };

  private _closeCreateDialog = () => {
    this._createOpen = false;
  };

  private _onCreateDialogHide = () => {
    // ``light-dismiss`` and the form's own Cancel/Esc paths both
    // funnel through ``wa-after-hide``. Mirror our state back so
    // the next open call is clean.
    this._createOpen = false;
  };

  /** Selection badges on the right of the trigger. ≤ 2 selections
   *  render as removable individual badges; > 2 collapse to a
   *  single count badge whose × clears all selected labels. The
   *  individual badges use each label's own colour to keep the
   *  trigger consistent with how chips look in the popover and
   *  elsewhere in the app. */
  private _renderBadges() {
    const count = this.selected.length;
    const clearLabel = this._localize("dashboard.filter_clear_all");
    return html`
      <span class="facet-trigger-divider" aria-hidden="true"></span>
      <span class="facet-trigger-badges">
        ${count > 2
          ? html`<span class="facet-trigger-badge">
              <span class="facet-trigger-badge-label"
                >${this._localize("dashboard.filter_multi_selected", {
                  count,
                })}</span
              >
              <button
                class="facet-trigger-badge-remove"
                type="button"
                aria-label=${clearLabel}
                title=${clearLabel}
                @click=${this._onClearClick}
              >
                <wa-icon library="mdi" name="close"></wa-icon>
              </button>
            </span>`
          : this.selected.map((id) => {
              // Skip rendering until the catalog has the label.
              // The selection list is restored from the URL synchronously
              // in ``connectedCallback`` but the labelsContext push
              // arrives a tick later over WS — without this guard the
              // badge briefly renders the raw label id (a long opaque
              // hex string) before flipping to the human name. Dropping
              // the badge entirely for that window is cleaner than
              // showing "loading…" placeholder copy.
              const label = this._catalog.find((l) => l.id === id);
              if (!label) return nothing;
              const display = label.name;
              const removeAria = this._localize("dashboard.labels_remove", {
                name: display,
              });
              // Trigger badges stay neutral on purpose — the
              // popover shows the colour-tinted chips, but
              // surfacing label colour up in the toolbar pill
              // makes the row of facet filters read noisy. The
              // name alone is enough context here.
              return html`<span class="facet-trigger-badge" title=${display}>
                <span class="facet-trigger-badge-label">${display}</span>
                <button
                  class="facet-trigger-badge-remove"
                  type="button"
                  aria-label=${removeAria}
                  title=${removeAria}
                  @click=${(e: Event) => this._onRemoveOne(e, id)}
                >
                  <wa-icon library="mdi" name="close"></wa-icon>
                </button>
              </span>`;
            })}
      </span>
    `;
  }

  private _renderPopover(selectedSet: Set<string>) {
    return html`
      <div
        class="facet-popover"
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
        ? html`<div class="facet-empty" role="status">
            ${this._localize("dashboard.labels_dialog_empty")}
          </div>`
        : html`<div class="facet-list" role="listbox">
            ${this._catalog.map((label) => {
              const checked = selectedSet.has(label.id);
              const count = this.usageCounts[label.id] ?? 0;
              return html`<div class="row-wrap">
                <button
                  class="facet-row"
                  type="button"
                  role="checkbox"
                  aria-checked=${checked ? "true" : "false"}
                  @click=${() => this._toggleLabel(label.id, !checked)}
                >
                  <span class="facet-row-check" aria-hidden="true">
                    ${checked
                      ? html`<wa-icon library="mdi" name="check"></wa-icon>`
                      : nothing}
                  </span>
                  <span class="facet-row-name">
                    <span class="label-chip" style=${labelChipStyleString(label.color)}
                      >${label.name}</span
                    >
                  </span>
                  <span class="facet-row-count" aria-hidden="true">${count}</span>
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
                        })
                      );
                    }}
                  >
                    <wa-icon library="mdi" name="trash-can-outline"></wa-icon>
                  </button>
                </div>
              </div>`;
            })}
          </div>`}
      ${this.selected.length > 0
        ? html`<div class="facet-footer">
            <button class="facet-clear-link" type="button" @click=${this._clear}>
              ${this._localize("dashboard.filter_clear_all")}
            </button>
          </div>`
        : nothing}
      <div class="create-section ${isEmpty ? "create-section--empty" : ""}">
        <button class="create-trigger" type="button" @click=${this._openCreateDialog}>
          <wa-icon library="mdi" name="plus"></wa-icon>
          ${this._localize("dashboard.labels_create")}
        </button>
      </div>
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
        <span class="edit-title">${this._localize("dashboard.labels_edit_label")}</span>
      </div>
      <div class="create-section create-section--empty">
        <esphome-label-form
          .existingNames=${this._catalog.map((l) => l.name)}
          .editing=${label}
          compact
          @label-saved=${this._onLabelSaved}
          @editing-cancel=${this._exitEditMode}
        ></esphome-label-form>
      </div>
    `;
  }

  private _onLabelCreated = (e: CustomEvent<Label>) => {
    // Dismiss the create dialog now that the label exists; the
    // labelsContext push will refresh the catalog so the user's
    // next popover open shows the new row.
    this._createOpen = false;
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

  private _onClearClick = (e: Event) => {
    // Don't let the surrounding trigger toggle the popover when a
    // badge's × is what got pressed.
    e.stopPropagation();
    this._emit([]);
    this._close();
  };

  /** Remove a single selected label from the trigger badge row
   *  without opening the popover. */
  private _onRemoveOne = (e: Event, id: string) => {
    e.stopPropagation();
    this._emit(this.selected.filter((x) => x !== id));
  };

  private _emit(next: string[]) {
    this.dispatchEvent(
      new CustomEvent<string[]>("labels-filter-change", {
        detail: next,
        bubbles: true,
        composed: true,
      })
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
