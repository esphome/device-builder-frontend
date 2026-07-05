/**
 * Label editor for the device drawer.
 *
 * In-drawer affordance is intentionally minimal: a chip row with
 * per-chip × buttons plus a single "Edit labels" trigger. The
 * full assignment / create UI lives behind that trigger in an
 * ``<esphome-base-dialog>`` so the drawer stays scannable when a
 * device carries a long list of labels.
 *
 * The dialog body has three parts: a search input, a catalog list
 * where each row is a checkbox toggling the device's assignment
 * (``devices/set_labels`` round trips, optimistically reflected in
 * the chip row immediately), and an inline "Create new label" form
 * (name + optional color swatch) that calls ``labels/create`` and
 * then assigns the freshly-minted label.
 *
 * The component reads from context: ``apiContext`` for the WS
 * round trips and ``labelsContext`` for the live catalog (so a
 * ``label_*`` event from another client updates the dialog without
 * a re-fetch). Per-device assignments are owned by the caller —
 * we receive ``device`` as a property and rely on the subsequent
 * ``DEVICE_UPDATED`` push (fired from the backend after
 * ``set_labels`` reloads the device) to reset our optimistic
 * override.
 */
import { consume } from "@lit/context";
import { mdiCheck, mdiClose, mdiPencil, mdiTagMultiple } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { ConfiguredDevice, Label } from "../../api/types/devices.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, labelsContext, localizeContext } from "../../context/index.js";
import {
  dialogChromeStyles,
  quietCloseButtonStyles,
} from "../../styles/dialog-chrome.js";
import { espHomeStyles } from "../../styles/shared.js";
import { DialogOpenController } from "../../util/dialog-open-controller.js";
import {
  labelChipStyles,
  renderLabelChip,
  resolveLabelIds,
} from "../../util/label-chip-template.js";
import { labelChipStyleString } from "../../util/label-style.js";
import { notifyError } from "../../util/notify.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import "./label-form.js";
import type { ESPHomeLabelForm } from "./label-form.js";
import { labelsListStyles } from "./labels-list-styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../base-dialog.js";

registerMdiIcons({
  check: mdiCheck,
  close: mdiClose,
  pencil: mdiPencil,
  "tag-multiple": mdiTagMultiple,
});

@customElement("esphome-device-labels-editor")
export class ESPHomeDeviceLabelsEditor extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  @state()
  private _api?: ESPHomeAPI;

  @consume({ context: labelsContext, subscribe: true })
  @state()
  private _catalog: Label[] = [];

  @property({ attribute: false })
  device!: ConfiguredDevice;

  /** True while a ``set_labels`` round trip is in flight. Used to
   *  gate optimistic-state cleanup; toggle clicks are still
   *  accepted and queued so fast multi-toggle feels responsive. */
  @state()
  private _saving = false;

  /** Snapshot of ``device.configuration`` taken when the user
   *  initiated a ``labels/create`` round trip. ``null`` means "no
   *  create in flight". A device swap mid-flight clears it (in
   *  ``willUpdate``) and the late ``label-created`` event is
   *  ignored — without this, the freshly-minted label would get
   *  assigned to whatever device the drawer happens to be showing
   *  by the time the create resolves, which may not be the device
   *  the user clicked Create from. */
  private _pendingCreateConfig: string | null = null;

  /** Optimistic label assignment that overrides ``device.labels``
   *  while a save is in flight or queued. Lets the user toggle
   *  multiple chips quickly without each click computing ``next``
   *  off a stale prop — the editor reads from this state until
   *  the next ``DEVICE_UPDATED`` push hands the prop a list that
   *  matches what we already wrote. ``null`` means "no pending
   *  override; trust the prop". */
  @state()
  private _optimisticLabels: string[] | null = null;

  /** Promise chain that serializes ``set_labels`` round trips so
   *  fast successive clicks reach the backend in click order
   *  rather than in network-arrival order — without serialization,
   *  the backend's "replace wholesale" semantics make the final
   *  state non-deterministic on overlapping requests. */
  private _saveChain: Promise<unknown> = Promise.resolve();

  private readonly _dialog = new DialogOpenController(this);

  @query("esphome-label-form")
  private _createForm?: ESPHomeLabelForm;

  static styles = [
    espHomeStyles,
    labelChipStyles,
    labelsListStyles,
    // Neutral header + title + quiet close button (shared) — dialog-chrome.ts.
    dialogChromeStyles,
    quietCloseButtonStyles,
    css`
      :host {
        display: block;
      }

      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
      }

      .empty {
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        font-style: italic;
      }

      .assigned-chip {
        position: relative;
        padding-right: 6px;
        /* Override the shared label-chip 'overflow: hidden' so a
           keyboard focus ring on the nested remove button isn't
           clipped at the chip's rounded edge. The chip's own ellipsis
           still works because the label text is truncated by the
           inline 'title' and the chip's natural width (driven by
           white-space:nowrap) — no overflow clip needed for that. */
        overflow: visible;
      }

      .assigned-chip .remove-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        margin-left: 2px;
        padding: 0;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        cursor: pointer;
        opacity: 0.7;
      }

      .assigned-chip .remove-btn:hover {
        opacity: 1;
      }

      .assigned-chip .remove-btn:focus-visible {
        opacity: 1;
        outline: 2px solid currentColor;
        outline-offset: 1px;
      }

      .assigned-chip .remove-btn wa-icon {
        font-size: 12px;
      }

      .edit-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 10px;
        border-radius: 999px;
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        line-height: 1.4;
        background: transparent;
        color: var(--wa-color-text-quiet);
        border: var(--wa-border-width-s) dashed var(--wa-color-surface-border);
        cursor: pointer;
        font-family: inherit;
      }

      .edit-btn:hover {
        color: var(--wa-color-text-normal);
        border-color: var(--wa-color-text-quiet);
      }

      .edit-btn wa-icon {
        font-size: 12px;
      }

      /* ─── Dialog ──────────────────────────────────────────── */

      esphome-base-dialog {
        --width: 480px;
      }

      /* Neutral header + title + quiet close come from dialog-chrome.ts. */
      esphome-base-dialog::part(body) {
        padding: 0 var(--wa-space-l) var(--wa-space-l);
      }

      /* Cap the list height for the in-drawer editor (the bulk
         picker uses a viewport-relative cap). labelsListStyles
         supplies overflow + bleed-into-padding + the row + check
         shapes; this just sets the local height limit. */
      .options {
        max-height: 320px;
      }

      .create-section {
        margin-top: var(--wa-space-l);
        padding-top: var(--wa-space-m);
        border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }
    `,
  ];

  protected willUpdate(changed: Map<string, unknown>) {
    if (!changed.has("device")) return;
    const prev = changed.get("device") as ConfiguredDevice | undefined;
    // A same-device prop update — the ``DEVICE_UPDATED`` push that lands
    // after our own ``set_labels`` — now carries the saved labels, so drop
    // the optimistic override and trust the prop. Crucially, DON'T close the
    // dialog: the user is mid-edit and toggling more labels, and each toggle
    // round-trips through this same push.
    this._optimisticLabels = null;
    // Only a real swap to a *different* device tears down the transient edit
    // state and closes the dialog; otherwise a half-typed "create" form would
    // persist into the next device's editor and a still-pending save chained
    // against the previous device would gate this one's ``_saving`` indicator.
    if (prev !== undefined && prev.configuration !== this.device.configuration) {
      this._dialog.open = false;
      this._createForm?.collapse();
      this._saving = false;
      this._saveChain = Promise.resolve();
      // Drop any in-flight create snapshot so a late ``label-created``
      // arriving after the swap is ignored rather than misapplied.
      this._pendingCreateConfig = null;
    }
  }

  /** Effective label assignment — optimistic state if a save is
   *  pending, otherwise the prop. Centralised so render and
   *  toggle logic both read from the same source and don't drift. */
  private get _currentLabelIds(): string[] {
    return this._optimisticLabels ?? this.device.labels ?? [];
  }

  protected render() {
    const assigned = resolveLabelIds(this._currentLabelIds, this._catalog);

    return html`
      <div class="row">
        ${
          assigned.length === 0
            ? html`<span class="empty">${this._localize("dashboard.labels_none")}</span>`
            : nothing
        }
        ${assigned.map(
          (label) =>
            html`<span
              class="label-chip assigned-chip"
              style=${labelChipStyleString(label.color)}
              title=${label.name}
              >${label.name}<button
                class="remove-btn"
                type="button"
                aria-label=${this._localize("dashboard.labels_remove", {
                  name: label.name,
                })}
                @click=${() => this._unassign(label.id)}
              >
                <wa-icon library="mdi" name="close"></wa-icon>
              </button>
            </span>`
        )}
        <button class="edit-btn" type="button" @click=${this._openDialog}>
          <wa-icon library="mdi" name="pencil"></wa-icon>
          ${this._localize("dashboard.labels_edit")}
        </button>
      </div>
      ${this._renderDialog()}
    `;
  }

  private _renderDialog() {
    const assignedSet = new Set(this._currentLabelIds);
    return html`
      <esphome-base-dialog
        ?open=${this._dialog.open}
        .label=${this._localize("dashboard.labels_dialog_title")}
        @request-close=${this._dialog.onRequestClose}
        @after-hide=${this._onDialogClose}
      >
        <div
          class="options"
          role="group"
          aria-label=${this._localize("dashboard.drawer_labels")}
        >
          ${
            this._catalog.length === 0
              ? html`<div class="option-empty">
                  ${this._localize("dashboard.labels_dialog_empty")}
                </div>`
              : this._catalog.map((label) => {
                  const checked = assignedSet.has(label.id);
                  return html`<button
                    class="option"
                    type="button"
                    role="checkbox"
                    aria-checked=${checked ? "true" : "false"}
                    @click=${() => this._toggleAssignment(label.id, !checked)}
                  >
                    <span class="option-check ${checked ? "option-check--checked" : ""}">
                      ${
                        checked
                          ? html`<wa-icon library="mdi" name="check"></wa-icon>`
                          : nothing
                      }
                    </span>
                    ${renderLabelChip(label)}
                  </button>`;
                })
          }
        </div>
        <div class="create-section">
          <esphome-label-form
            .existingNames=${this._catalog.map((l) => l.name)}
            @submitting=${this._onCreateSubmitting}
            @label-created=${this._onCreateResolved}
          ></esphome-label-form>
        </div>
      </esphome-base-dialog>
    `;
  }

  /** Snapshot the device the user clicked Create from — checked
   *  in ``_onCreateResolved`` against the current device so a
   *  mid-flight swap can't misroute the assignment. */
  private _onCreateSubmitting = () => {
    this._pendingCreateConfig = this.device.configuration;
  };

  private _onCreateResolved = (e: CustomEvent<Label>) => {
    const targetConfig = this._pendingCreateConfig;
    this._pendingCreateConfig = null;
    if (targetConfig === null) return;
    if (targetConfig !== this.device.configuration) return;
    void this._assignNewLabel(e.detail);
  };

  private _openDialog = () => {
    this._createForm?.collapse();
    this._dialog.open = true;
  };

  private _onDialogClose = () => {
    this._dialog.open = false;
    this._createForm?.collapse();
  };

  /** Re-emit a ``label_ids`` change as a serialized
   *  ``set_labels`` round trip. We rely on the backend's
   *  ``DEVICE_UPDATED`` push to refresh the chip row; the
   *  optimistic-state fallback keeps the UI consistent in the
   *  meantime. */
  private async _persist(nextIds: string[]) {
    if (!this._api) return;
    const api = this._api;
    const config = this.device.configuration;
    this._saving = true;
    const task = this._saveChain.then(async () => {
      try {
        await api.setDeviceLabels(config, nextIds);
      } catch (err) {
        console.warn("set_labels failed", err);
        notifyError(this._localize("dashboard.labels_save_failed"));
      }
    });
    this._saveChain = task;
    await task;
    if (this._saveChain === task) {
      this._saving = false;
    }
  }

  private async _toggleAssignment(labelId: string, assign: boolean) {
    const current = this._currentLabelIds;
    const next = assign
      ? current.includes(labelId)
        ? current.slice()
        : [...current, labelId]
      : current.filter((id) => id !== labelId);
    this._optimisticLabels = next;
    await this._persist(next);
  }

  private async _unassign(labelId: string) {
    await this._toggleAssignment(labelId, false);
  }

  /** Handle a freshly-created Label emitted by the inline form by
   *  assigning it to the current device. The form already round-
   *  tripped to ``labels/create`` and surfaced its own toast on
   *  failure — this method is only on the success path, so the
   *  only thing left is the ``set_labels`` follow-up. */
  private async _assignNewLabel(label: Label) {
    const next = [...this._currentLabelIds, label.id];
    this._optimisticLabels = next;
    await this._persist(next);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-labels-editor": ESPHomeDeviceLabelsEditor;
  }
}
