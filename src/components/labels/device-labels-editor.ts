/**
 * Inline label editor for the device drawer.
 *
 * Renders the device's currently-assigned labels as removable chips
 * plus an "Add label" affordance that opens a popover with:
 *  - a checkbox list of every catalog label (toggle assigns /
 *    unassigns immediately via ``devices/set_labels``);
 *  - a search input that narrows the catalog list;
 *  - an inline "Create new label" form (name + optional color
 *    swatch) that calls ``labels/create`` and immediately assigns
 *    the freshly-minted label to the device.
 *
 * The component is read-from-context: it consumes ``apiContext``
 * for the WS round trips and ``labelsContext`` for the live catalog
 * (so a ``label_*`` event from another client updates the dropdown
 * without a re-fetch). Per-device assignments are owned by the
 * caller — we receive ``device`` as a property and rely on the
 * subsequent ``DEVICE_UPDATED`` push (which the backend fires from
 * ``set_labels`` after the scanner reload) to refresh the chip row.
 */
import { consume } from "@lit/context";
import {
  mdiCheck,
  mdiClose,
  mdiPlus,
  mdiTagMultiple,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { ConfiguredDevice, Label } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, labelsContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { EscapeController } from "../../util/escape-controller.js";
import { LABEL_COLOR_SWATCHES, labelChipStyleString } from "../../util/label-style.js";
import {
  labelChipStyles,
  resolveLabelIds,
} from "../../util/label-chip-template.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/input/input.js";

registerMdiIcons({
  check: mdiCheck,
  close: mdiClose,
  plus: mdiPlus,
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

  /** Whether the popover is currently visible. Toggled by the
   *  "Add label" button; closed by Escape or by clicking outside. */
  @state()
  private _popoverOpen = false;

  /** Substring filter applied to the catalog when the popover is
   *  open. Case-insensitive. */
  @state()
  private _filter = "";

  /** Whether the "Create new label" form is expanded inside the
   *  popover. Collapsed by default to keep the popover compact. */
  @state()
  private _createOpen = false;

  /** Pending values for the in-progress label creation. */
  @state()
  private _newName = "";

  @state()
  private _newColor: string | null = null;

  /** True while a ``set_labels`` round trip is in flight. We don't
   *  block the popover during this — optimistic UX is fine since
   *  the backend's reject path is rare (only "unknown id", which
   *  shouldn't happen with the live catalog) — but we do disable
   *  the create button to prevent double-fires. */
  @state()
  private _saving = false;

  /** Close the popover on Escape. Bound to ``window`` rather than
   *  ``document`` because the drawer's own Escape listener is on
   *  ``window`` and the controller's ``defaultPrevented`` guard
   *  prevents both from firing on the same press. */
  private _escape = new EscapeController(this, (e) => {
    e.preventDefault();
    this._closePopover();
  });

  static styles = [
    espHomeStyles,
    labelChipStyles,
    css`
      :host {
        display: block;
        position: relative;
      }

      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
      }

      .assigned-chip {
        position: relative;
        padding-right: 6px;
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

      .assigned-chip .remove-btn wa-icon {
        font-size: 12px;
      }

      .add-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border-radius: 999px;
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        line-height: 1.4;
        background: transparent;
        color: var(--wa-color-text-quiet);
        border: var(--wa-border-width-s) dashed var(--wa-color-surface-border);
        cursor: pointer;
      }

      .add-btn:hover {
        color: var(--wa-color-text-normal);
        border-color: var(--wa-color-text-quiet);
      }

      .add-btn wa-icon {
        font-size: 12px;
      }

      /* The popover is positioned below the chip row; keeps it
         within the drawer's body so the drawer's overflow handles
         scroll if the catalog grows long. */
      .popover {
        margin-top: var(--wa-space-s);
        background: var(--wa-color-surface-default);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        box-shadow: var(--wa-shadow-m);
        padding: var(--wa-space-s);
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s);
        max-height: 320px;
        overflow-y: auto;
      }

      .options {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 180px;
        overflow-y: auto;
      }

      .option {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 6px;
        border-radius: var(--wa-border-radius-s);
        cursor: pointer;
      }

      .option:hover {
        background: var(--wa-color-surface-lowered);
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

      .empty {
        text-align: center;
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        padding: var(--wa-space-s);
      }

      .divider {
        height: 1px;
        background: var(--wa-color-surface-border);
      }

      .create-toggle {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 6px;
        background: transparent;
        border: none;
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--esphome-primary);
        cursor: pointer;
        align-self: flex-start;
      }

      .create-toggle wa-icon {
        font-size: 14px;
      }

      .create-form {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .swatch-row {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      .swatch {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        cursor: pointer;
        padding: 0;
      }

      .swatch--selected {
        outline: 2px solid var(--esphome-primary);
        outline-offset: 2px;
      }

      .swatch--clear {
        background: transparent;
        color: var(--wa-color-text-quiet);
        font-size: 12px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .create-actions {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
      }

      .btn {
        padding: 4px 10px;
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        border-radius: var(--wa-border-radius-s);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: var(--wa-color-surface-default);
        color: var(--wa-color-text-normal);
        cursor: pointer;
      }

      .btn--primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
        border-color: var(--esphome-primary);
      }

      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ];

  protected willUpdate(changed: Map<string, unknown>) {
    // Keep the controller in sync with the popover state so the
    // listener detaches when the popover closes.
    if (changed.has("_popoverOpen")) this._escape.set(this._popoverOpen);
    if (changed.has("device")) {
      // Reset transient editor state when the drawer swaps to a
      // different device; otherwise a half-typed "create" form
      // would persist into the next device's editor.
      this._popoverOpen = false;
      this._filter = "";
      this._createOpen = false;
      this._newName = "";
      this._newColor = null;
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

  /** Capture-phase document click that closes the popover when the
   *  user clicks outside the editor. Uses ``composedPath`` so the
   *  shadow-DOM internals of ``wa-input`` don't trigger close. */
  private _onDocumentClick = (e: MouseEvent) => {
    if (!this._popoverOpen) return;
    const path = e.composedPath();
    if (path.includes(this)) return;
    this._closePopover();
  };

  protected render() {
    const assigned = resolveLabelIds(this.device.labels, this._catalog);
    const assignedIds = new Set(assigned.map((l) => l.id));

    return html`
      <div class="row">
        ${assigned.length === 0 && !this._popoverOpen
          ? html`<span class="empty">${this._localize("dashboard.labels_none")}</span>`
          : nothing}
        ${assigned.map(
          (label) => html`<span
            class="label-chip assigned-chip"
            style=${labelChipStyleString(label.color)}
            title=${label.name}
            >${label.name}<button
              class="remove-btn"
              type="button"
              aria-label=${this._localize("dashboard.labels_remove", { name: label.name })}
              @click=${() => this._unassign(label.id)}
            >
              <wa-icon library="mdi" name="close"></wa-icon>
            </button>
          </span>`,
        )}
        <button
          class="add-btn"
          type="button"
          aria-haspopup="menu"
          aria-expanded=${this._popoverOpen ? "true" : "false"}
          @click=${this._togglePopover}
        >
          <wa-icon library="mdi" name="plus"></wa-icon>
          ${this._localize("dashboard.labels_add")}
        </button>
      </div>
      ${this._popoverOpen ? this._renderPopover(assignedIds) : nothing}
    `;
  }

  private _renderPopover(assignedIds: Set<string>) {
    const filter = this._filter.trim().toLowerCase();
    const filtered = filter
      ? this._catalog.filter((l) => l.name.toLowerCase().includes(filter))
      : this._catalog;

    return html`
      <div class="popover" role="menu">
        <wa-input
          type="search"
          with-clear
          placeholder=${this._localize("dashboard.labels_search_placeholder")}
          .value=${this._filter}
          @input=${(e: Event) => {
            this._filter = (e.currentTarget as unknown as { value: string }).value;
          }}
        ></wa-input>
        <div class="options">
          ${filtered.length === 0
            ? html`<div class="empty">
                ${this._localize("dashboard.labels_no_matches")}
              </div>`
            : filtered.map((label) => {
                const checked = assignedIds.has(label.id);
                return html`<button
                  class="option"
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked=${checked ? "true" : "false"}
                  @click=${() => this._toggleAssignment(label.id, !checked)}
                >
                  <span class="option-check ${checked ? "option-check--checked" : ""}">
                    ${checked
                      ? html`<wa-icon library="mdi" name="check"></wa-icon>`
                      : nothing}
                  </span>
                  <span class="label-chip" style=${labelChipStyleString(label.color)}
                    >${label.name}</span
                  >
                </button>`;
              })}
        </div>
        <div class="divider"></div>
        ${this._createOpen ? this._renderCreateForm() : html`<button
          class="create-toggle"
          type="button"
          @click=${() => {
            this._createOpen = true;
            this._newName = this._filter;
          }}
        >
          <wa-icon library="mdi" name="plus"></wa-icon>
          ${this._localize("dashboard.labels_create")}
        </button>`}
      </div>
    `;
  }

  private _renderCreateForm() {
    const trimmed = this._newName.trim();
    const duplicate = this._catalog.some(
      (l) => l.name.toLowerCase() === trimmed.toLowerCase(),
    );
    const canCreate = trimmed.length > 0 && trimmed.length <= 50 && !duplicate;
    return html`
      <form
        class="create-form"
        @submit=${(e: Event) => {
          e.preventDefault();
          if (canCreate) void this._createAndAssign();
        }}
      >
        <wa-input
          placeholder=${this._localize("dashboard.labels_create_placeholder")}
          maxlength="50"
          .value=${this._newName}
          @input=${(e: Event) => {
            this._newName = (e.currentTarget as unknown as { value: string }).value;
          }}
        ></wa-input>
        <div class="swatch-row" role="radiogroup" aria-label=${this._localize("dashboard.labels_color")}>
          <button
            type="button"
            class="swatch swatch--clear ${this._newColor === null ? "swatch--selected" : ""}"
            aria-label=${this._localize("dashboard.labels_color_none")}
            title=${this._localize("dashboard.labels_color_none")}
            @click=${() => {
              this._newColor = null;
            }}
          >
            ${this._newColor === null ? html`<wa-icon library="mdi" name="check"></wa-icon>` : nothing}
          </button>
          ${LABEL_COLOR_SWATCHES.map(
            (c) => html`<button
              type="button"
              class="swatch ${this._newColor === c ? "swatch--selected" : ""}"
              style="background:${c}"
              aria-label=${c}
              title=${c}
              @click=${() => {
                this._newColor = c;
              }}
            ></button>`,
          )}
        </div>
        <div class="create-actions">
          <button
            type="button"
            class="btn"
            @click=${() => {
              this._createOpen = false;
              this._newName = "";
              this._newColor = null;
            }}
          >
            ${this._localize("dashboard.labels_create_cancel")}
          </button>
          <button
            type="submit"
            class="btn btn--primary"
            ?disabled=${!canCreate || this._saving}
          >
            ${this._localize("dashboard.labels_create_submit")}
          </button>
        </div>
      </form>
    `;
  }

  private _togglePopover = () => {
    this._popoverOpen = !this._popoverOpen;
    if (!this._popoverOpen) {
      this._createOpen = false;
      this._filter = "";
    }
  };

  private _closePopover() {
    if (!this._popoverOpen) return;
    this._popoverOpen = false;
    this._createOpen = false;
    this._filter = "";
  }

  /** Re-emit a ``label_ids`` change as a ``set_labels`` round trip.
   *
   *  We compute the new full list locally (the API contract is
   *  "replace, not diff") and rely on the backend's
   *  ``DEVICE_UPDATED`` push to refresh the chip row; if the round
   *  trip fails, the surface stays consistent because we never
   *  mutated the local device. */
  private async _persist(nextIds: string[]) {
    if (!this._api) return;
    this._saving = true;
    try {
      await this._api.setDeviceLabels(this.device.configuration, nextIds);
    } catch (err) {
      console.warn("set_labels failed", err);
      toast.error(this._localize("dashboard.labels_save_failed"), {
        richColors: true,
      });
    } finally {
      this._saving = false;
    }
  }

  private async _toggleAssignment(labelId: string, assign: boolean) {
    const current = this.device.labels ?? [];
    const next = assign
      ? current.includes(labelId)
        ? current.slice()
        : [...current, labelId]
      : current.filter((id) => id !== labelId);
    await this._persist(next);
  }

  private async _unassign(labelId: string) {
    await this._toggleAssignment(labelId, false);
  }

  private async _createAndAssign() {
    if (!this._api) return;
    const name = this._newName.trim();
    if (!name) return;
    this._saving = true;
    try {
      const created = await this._api.createLabel({
        name,
        color: this._newColor,
      });
      // Assign the freshly-minted label to the device. The catalog
      // updates via the ``LABEL_CREATED`` push (which app-shell
      // routes into ``labelsContext``); we don't touch ``_catalog``
      // here so the live context stays the source of truth.
      const next = [...(this.device.labels ?? []), created.id];
      await this._api.setDeviceLabels(this.device.configuration, next);
      this._createOpen = false;
      this._newName = "";
      this._newColor = null;
      this._filter = "";
    } catch (err) {
      console.warn("label create failed", err);
      toast.error(this._localize("dashboard.labels_create_failed"), {
        richColors: true,
      });
    } finally {
      this._saving = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-labels-editor": ESPHomeDeviceLabelsEditor;
  }
}
