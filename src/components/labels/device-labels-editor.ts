/**
 * Label editor for the device drawer.
 *
 * In-drawer affordance is intentionally minimal: a chip row with
 * per-chip × buttons plus a single "Edit labels" trigger. The
 * full assignment / create UI lives behind that trigger in a
 * ``<wa-dialog>`` so the drawer stays scannable when a device
 * carries a long list of labels.
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
import {
  mdiCheck,
  mdiClose,
  mdiPencil,
  mdiPlus,
  mdiTagMultiple,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { ConfiguredDevice, Label } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, labelsContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { LABEL_COLOR_SWATCHES, labelChipStyleString } from "../../util/label-style.js";
import {
  labelChipStyles,
  resolveLabelIds,
} from "../../util/label-chip-template.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/input/input.js";

registerMdiIcons({
  check: mdiCheck,
  close: mdiClose,
  pencil: mdiPencil,
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

  /** Substring filter applied to the catalog inside the dialog.
   *  Case-insensitive. */
  @state()
  private _filter = "";

  /** Whether the "Create new label" inline form is expanded inside
   *  the dialog. Collapsed by default to keep the dialog compact. */
  @state()
  private _createOpen = false;

  /** Pending values for the in-progress label creation. */
  @state()
  private _newName = "";

  @state()
  private _newColor: string | null = null;

  /** True while a ``set_labels`` round trip is in flight. Disables
   *  the create submit button to prevent double-fires; toggle
   *  clicks are still accepted and queued so fast multi-toggle
   *  feels responsive. */
  @state()
  private _saving = false;

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

  @query("wa-dialog")
  private _dialog?: HTMLElement & { open: boolean };

  static styles = [
    espHomeStyles,
    labelChipStyles,
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

      wa-dialog {
        --width: 460px;
      }

      wa-dialog::part(header) {
        padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-s);
      }

      wa-dialog::part(title) {
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      wa-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
      }

      wa-dialog::part(body) {
        padding: 0 var(--wa-space-l) var(--wa-space-l);
      }

      wa-dialog::part(footer) {
        display: none;
      }

      .dialog-search {
        margin-bottom: var(--wa-space-s);
      }

      .options {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 300px;
        overflow-y: auto;
        margin: 0 calc(var(--wa-space-l) * -1);
        padding: 0 var(--wa-space-l);
      }

      .option {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 8px;
        border-radius: var(--wa-border-radius-s);
        cursor: pointer;
        background: transparent;
        border: none;
        text-align: left;
        font-family: inherit;
        color: inherit;
      }

      .option:hover {
        background: var(--wa-color-surface-lowered);
      }

      .option-check {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
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
        font-size: 13px;
      }

      .option-empty {
        text-align: center;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        padding: var(--wa-space-m);
      }

      .divider {
        height: 1px;
        background: var(--wa-color-surface-border);
        margin: var(--wa-space-s) 0;
      }

      .create-toggle {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 6px 8px;
        background: transparent;
        border: none;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--esphome-primary);
        cursor: pointer;
        align-self: flex-start;
        font-family: inherit;
      }

      .create-toggle wa-icon {
        font-size: 14px;
      }

      .create-form {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s);
        padding: var(--wa-space-s) 0;
      }

      .create-form-label {
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
      }

      .swatch-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .swatch {
        width: 24px;
        height: 24px;
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
        gap: var(--wa-space-xs);
        justify-content: flex-end;
      }

      .btn {
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
    if (changed.has("device")) {
      // Reset transient state when the drawer swaps to a different
      // device; otherwise a half-typed "create" form would persist
      // into the next device's editor and a still-pending save
      // chained against the previous device would gate this one's
      // ``_saving`` indicator until that promise settled.
      if (this._dialog) this._dialog.open = false;
      this._filter = "";
      this._createOpen = false;
      this._newName = "";
      this._newColor = null;
      this._optimisticLabels = null;
      this._saving = false;
      this._saveChain = Promise.resolve();
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
        ${assigned.length === 0
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
          class="edit-btn"
          type="button"
          @click=${this._openDialog}
        >
          <wa-icon library="mdi" name="pencil"></wa-icon>
          ${this._localize("dashboard.labels_edit")}
        </button>
      </div>
      ${this._renderDialog()}
    `;
  }

  private _renderDialog() {
    const assignedSet = new Set(this._currentLabelIds);
    const filter = this._filter.trim().toLowerCase();
    const filtered = filter
      ? this._catalog.filter((l) => l.name.toLowerCase().includes(filter))
      : this._catalog;
    return html`
      <wa-dialog
        label=${this._localize("dashboard.labels_dialog_title")}
        light-dismiss
        @wa-after-hide=${this._onDialogClose}
      >
        <div class="dialog-search">
          <wa-input
            type="search"
            with-clear
            placeholder=${this._localize("dashboard.labels_search_placeholder")}
            .value=${this._filter}
            @input=${(e: Event) => {
              this._filter = (e.currentTarget as unknown as { value: string }).value;
            }}
          ></wa-input>
        </div>
        <div class="options" role="group" aria-label=${this._localize("dashboard.drawer_labels")}>
          ${this._catalog.length === 0
            ? html`<div class="option-empty">
                ${this._localize("dashboard.labels_dialog_empty")}
              </div>`
            : filtered.length === 0
              ? html`<div class="option-empty">
                  ${this._localize("dashboard.labels_no_matches")}
                </div>`
              : filtered.map((label) => {
                  const checked = assignedSet.has(label.id);
                  return html`<button
                    class="option"
                    type="button"
                    role="checkbox"
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
            // Pre-fill the name from the current filter when the
            // user typed something that didn't match — saves the
            // re-type when "filter to find" turns into "didn't
            // exist, create it".
            this._newName = this._filter;
          }}
        >
          <wa-icon library="mdi" name="plus"></wa-icon>
          ${this._localize("dashboard.labels_create")}
        </button>`}
      </wa-dialog>
    `;
  }

  private _renderCreateForm() {
    const trimmed = this._newName.trim();
    const duplicate = this._catalog.some(
      (l) => l.name.toLowerCase() === trimmed.toLowerCase(),
    );
    const canCreate = trimmed.length > 0 && trimmed.length <= 50 && !duplicate;
    const values: (string | null)[] = [null, ...LABEL_COLOR_SWATCHES];
    return html`
      <form
        class="create-form"
        @submit=${(e: Event) => {
          e.preventDefault();
          if (canCreate) void this._createAndAssign();
        }}
      >
        <span class="create-form-label">${this._localize("dashboard.labels_create")}</span>
        <wa-input
          placeholder=${this._localize("dashboard.labels_create_placeholder")}
          maxlength="50"
          .value=${this._newName}
          @input=${(e: Event) => {
            this._newName = (e.currentTarget as unknown as { value: string }).value;
          }}
        ></wa-input>
        <div
          class="swatch-row"
          role="radiogroup"
          aria-label=${this._localize("dashboard.labels_color")}
          @keydown=${(e: KeyboardEvent) => this._onSwatchKeyDown(e, values)}
        >
          ${values.map((c) => {
            const selected = this._newColor === c;
            if (c === null) {
              return html`<button
                type="button"
                role="radio"
                aria-checked=${selected ? "true" : "false"}
                tabindex=${selected ? "0" : "-1"}
                class="swatch swatch--clear ${selected ? "swatch--selected" : ""}"
                aria-label=${this._localize("dashboard.labels_color_none")}
                title=${this._localize("dashboard.labels_color_none")}
                @click=${() => {
                  this._newColor = null;
                }}
              >
                ${selected ? html`<wa-icon library="mdi" name="check"></wa-icon>` : nothing}
              </button>`;
            }
            return html`<button
              type="button"
              role="radio"
              aria-checked=${selected ? "true" : "false"}
              tabindex=${selected ? "0" : "-1"}
              class="swatch ${selected ? "swatch--selected" : ""}"
              style="background:${c}"
              aria-label=${c}
              title=${c}
              @click=${() => {
                this._newColor = c;
              }}
            ></button>`;
          })}
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

  private _onSwatchKeyDown(e: KeyboardEvent, values: (string | null)[]) {
    let idx = values.indexOf(this._newColor);
    if (idx < 0) idx = 0;
    let next = idx;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (idx + 1) % values.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (idx - 1 + values.length) % values.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = values.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    this._newColor = values[next];
    requestAnimationFrame(() => {
      const swatch = this.renderRoot.querySelectorAll<HTMLButtonElement>(
        ".swatch",
      )[next];
      swatch?.focus();
    });
  }

  private _openDialog = () => {
    this._filter = "";
    this._createOpen = false;
    this._newName = "";
    this._newColor = null;
    if (this._dialog) this._dialog.open = true;
  };

  private _onDialogClose = () => {
    this._filter = "";
    this._createOpen = false;
    this._newName = "";
    this._newColor = null;
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
        toast.error(this._localize("dashboard.labels_save_failed"), {
          richColors: true,
        });
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
      const next = [...this._currentLabelIds, created.id];
      this._optimisticLabels = next;
      await this._persist(next);
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
