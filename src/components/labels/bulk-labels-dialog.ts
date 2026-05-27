/**
 * Bulk-labels dialog for multi-selected devices (#928).
 *
 * Tri-state checkbox semantics: when the picker opens, each label
 * shows ``checked`` (every selected device has it), ``unchecked``
 * (no selected device has it), or ``indeterminate`` (some do, some
 * don't). A click cycles to ``checked``; the next click cycles to
 * ``unchecked``. Labels the user never touched stay in their
 * derived state on Apply (no change). On Apply, per-device label
 * sets are computed by overlaying the user's explicit transitions
 * onto each device's current labels, then sent via the
 * ``devices/set_labels_bulk`` WS command.
 *
 * Intentionally a *separate* component from the single-device
 * ``<esphome-device-labels-editor>`` rather than a shared picker.
 * The two flows have different semantics: the single-device editor
 * persists every toggle optimistically; the bulk flow batches
 * changes behind an Apply button. Forcing them through one
 * abstraction would muddy both.
 */
import { consume } from "@lit/context";
import { mdiCheck, mdiClose, mdiMinus } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { ConfiguredDevice, Label } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, labelsContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { labelChipStyleString } from "../../util/label-style.js";
import { labelChipStyles } from "../../util/label-chip-template.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  check: mdiCheck,
  close: mdiClose,
  minus: mdiMinus,
});

export type TriState = "checked" | "unchecked" | "indeterminate";

@customElement("esphome-bulk-labels-dialog")
export class ESPHomeBulkLabelsDialog extends LitElement {
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
  devices: ConfiguredDevice[] = [];

  /** Per-label explicit user transitions. Absence means "leave
   *  derived state as-is on Apply" (no change to any device). */
  @state()
  private _pendingChanges: Map<string, "checked" | "unchecked"> = new Map();

  @state()
  private _saving = false;

  @query("wa-dialog")
  private _dialog?: HTMLElement & { open: boolean };

  /** Open the dialog. Resets pending changes to the empty map so a
   *  previous session's state doesn't leak. */
  open() {
    this._pendingChanges = new Map();
    if (this._dialog) this._dialog.open = true;
  }

  close() {
    if (this._dialog) this._dialog.open = false;
  }

  /** Derived tri-state for a label across the current device set. */
  private _derivedState(labelId: string): TriState {
    if (this.devices.length === 0) return "unchecked";
    let some = false;
    let all = true;
    for (const device of this.devices) {
      const has = (device.labels ?? []).includes(labelId);
      some = some || has;
      all = all && has;
    }
    if (all) return "checked";
    if (some) return "indeterminate";
    return "unchecked";
  }

  /** Effective state for rendering: pending override wins, else derived. */
  effectiveState(labelId: string): TriState {
    const pending = this._pendingChanges.get(labelId);
    if (pending !== undefined) return pending;
    return this._derivedState(labelId);
  }

  /** Compute the per-device updates payload the Apply button would send.
   *
   *  Exposed (not just inlined into ``_apply``) so the test suite
   *  can drive selection state and assert the resulting payload
   *  without mounting the API client. */
  computeUpdates(): Array<{ configuration: string; labelIds: string[] }> {
    return this.devices.map((device) => {
      const next = new Set(device.labels ?? []);
      for (const [labelId, change] of this._pendingChanges) {
        if (change === "checked") next.add(labelId);
        else next.delete(labelId);
      }
      return { configuration: device.configuration, labelIds: [...next] };
    });
  }

  /** True if the user has made any explicit transition (the Apply
   *  button is enabled only when there's something to apply). */
  get _hasPendingChanges(): boolean {
    return this._pendingChanges.size > 0;
  }

  static styles = [
    espHomeStyles,
    labelChipStyles,
    css`
      :host {
        display: contents;
      }

      wa-dialog {
        --width: min(480px, 92vw);
      }

      wa-dialog::part(header) {
        padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-s);
      }

      wa-dialog::part(title) {
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      wa-dialog::part(body) {
        padding: 0 var(--wa-space-l) var(--wa-space-m);
      }

      wa-dialog::part(footer) {
        padding: var(--wa-space-m) var(--wa-space-l) var(--wa-space-l);
        border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .options {
        display: flex;
        flex-direction: column;
        gap: 2px;
        /* Cap at ~60vh so on short mobile viewports the list still
           leaves room for the footer + header without the dialog
           clipping. */
        max-height: 60vh;
        overflow-y: auto;
        margin: 0 calc(var(--wa-space-l) * -1);
        padding: 0 var(--wa-space-l);
      }

      .option {
        display: flex;
        align-items: center;
        gap: 12px;
        /* ≥ 44 px tap target on every row (WCAG / iOS HIG). */
        min-height: 44px;
        padding: 8px 10px;
        border-radius: var(--wa-border-radius-m);
        cursor: pointer;
        background: transparent;
        border: none;
        text-align: left;
        font-family: inherit;
        color: inherit;
        transition: background-color 0.12s;
      }

      .option:hover {
        background: var(--wa-color-surface-lowered);
      }

      .option:focus-visible {
        outline: none;
        background: var(--wa-color-surface-lowered);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--esphome-primary), transparent 70%);
      }

      .option-check {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 5px;
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        flex-shrink: 0;
        color: var(--esphome-on-primary);
        background: var(--wa-color-surface-default);
      }

      .option-check--checked,
      .option-check--mixed {
        background: var(--esphome-primary);
        border-color: var(--esphome-primary);
      }

      /* The mixed state uses the same fill as checked but with a
         dash glyph instead of a tick, mirroring the platform-native
         indeterminate-checkbox affordance on macOS / Windows. */
      .option-check--mixed {
        background: color-mix(in srgb, var(--esphome-primary), transparent 30%);
      }

      .option-check wa-icon {
        font-size: 14px;
      }

      .option-empty {
        text-align: center;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        padding: var(--wa-space-m);
      }

      .footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
      }

      .btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 44px;
        padding: 8px 18px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: none;
        transition:
          background 0.12s,
          opacity 0.12s;
      }

      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn--cancel {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .btn--cancel:hover:not(:disabled) {
        background: var(--wa-color-surface-border);
      }

      .btn--primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .btn--primary:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
      }
    `,
  ];

  protected render() {
    const titleKey =
      this.devices.length === 1
        ? "dashboard.labels_bulk_dialog_title_one"
        : "dashboard.labels_bulk_dialog_title_other";
    return html`
      <wa-dialog
        label=${this._localize(titleKey, { count: this.devices.length })}
        light-dismiss
      >
        ${this._catalog.length === 0
          ? html`<div class="option-empty">
              ${this._localize("dashboard.labels_dialog_empty")}
            </div>`
          : html`<div
              class="options"
              role="group"
              aria-label=${this._localize("dashboard.drawer_labels")}
            >
              ${this._catalog.map((label) => this._renderOption(label))}
            </div>`}
        <div class="footer" slot="footer">
          <button
            class="btn btn--cancel"
            type="button"
            ?disabled=${this._saving}
            @click=${this.close}
          >
            ${this._localize("dashboard.labels_bulk_cancel")}
          </button>
          <button
            class="btn btn--primary"
            type="button"
            ?disabled=${this._saving || !this._hasPendingChanges}
            @click=${this._apply}
          >
            ${this._localize("dashboard.labels_bulk_apply")}
          </button>
        </div>
      </wa-dialog>
    `;
  }

  private _renderOption(label: Label) {
    const state = this.effectiveState(label.id);
    const checked = state === "checked";
    const mixed = state === "indeterminate";
    const ariaChecked = checked ? "true" : mixed ? "mixed" : "false";
    const hint = mixed ? this._localize("dashboard.labels_bulk_mixed_hint") : undefined;
    return html`<button
      class="option"
      type="button"
      role="checkbox"
      aria-checked=${ariaChecked}
      title=${hint ?? label.name}
      @click=${() => this._onToggle(label.id)}
    >
      <span
        class="option-check ${checked
          ? "option-check--checked"
          : mixed
            ? "option-check--mixed"
            : ""}"
      >
        ${checked
          ? html`<wa-icon library="mdi" name="check"></wa-icon>`
          : mixed
            ? html`<wa-icon library="mdi" name="minus"></wa-icon>`
            : nothing}
      </span>
      <span class="label-chip" style=${labelChipStyleString(label.color)}
        >${label.name}</span
      >
    </button>`;
  }

  private _onToggle(labelId: string) {
    const current = this.effectiveState(labelId);
    // ``checked`` → ``unchecked``; everything else → ``checked``.
    // The "indeterminate → checked" rule mirrors Gmail / GitHub
    // multi-select label semantics (one click "claims" the label
    // for every device; a second removes it from every device).
    const next: "checked" | "unchecked" = current === "checked" ? "unchecked" : "checked";
    const map = new Map(this._pendingChanges);
    map.set(labelId, next);
    this._pendingChanges = map;
  }

  private _apply = async () => {
    if (!this._api) return;
    const updates = this.computeUpdates();
    const count = updates.length;
    this._saving = true;
    try {
      const results = await this._api.setDeviceLabelsBulk(updates);
      const failures = results.filter((r) => !r.success);
      if (failures.length === 0) {
        const key =
          count === 1
            ? "dashboard.labels_bulk_saved_one"
            : "dashboard.labels_bulk_saved_other";
        toast.success(this._localize(key, { count }), { richColors: true });
      } else {
        const key =
          failures.length === 1
            ? "dashboard.labels_bulk_save_failed_one"
            : "dashboard.labels_bulk_save_failed_other";
        toast.error(this._localize(key, { count: failures.length }), {
          richColors: true,
        });
      }
      this.close();
    } catch (err) {
      console.warn("set_labels_bulk failed", err);
      toast.error(this._localize("dashboard.labels_save_failed"), {
        richColors: true,
      });
    } finally {
      this._saving = false;
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-bulk-labels-dialog": ESPHomeBulkLabelsDialog;
  }
}
