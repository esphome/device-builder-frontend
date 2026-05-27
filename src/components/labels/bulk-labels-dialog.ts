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
import { dialogActionButtonStyles } from "../../styles/dialog-action-buttons.js";
import { espHomeStyles } from "../../styles/shared.js";
import { labelChipStyleString } from "../../util/label-style.js";
import { labelChipStyles } from "../../util/label-chip-template.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { labelsListStyles } from "./labels-list-styles.js";

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

  // Arrow property so the Cancel button's ``@click=${this.close}``
  // captures a bound reference; a plain method would lose ``this``
  // when Lit re-dispatches the event and break the dialog dismiss.
  close = () => {
    if (this._dialog) this._dialog.open = false;
  };

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
    labelsListStyles,
    dialogActionButtonStyles,
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

      /* Cap the list height so the dialog fits short mobile
         viewports without clipping the footer slot. Adds to
         labelsListStyles which leaves height to the consumer. */
      .options {
        max-height: 60vh;
      }

      .footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
      }

      /* Icon-text alignment + ≥ 44 px tap target on the action
         buttons. dialogActionButtonStyles supplies the base shape
         (padding, radius, typography); these extend it. */
      .btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 44px;
      }

      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
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
        ?light-dismiss=${!this._saving}
        @wa-request-close=${this._onRequestClose}
      >
        ${this._catalog.length === 0
          ? html`<div class="option-empty" role="status">
              ${this._localize("dashboard.labels_bulk_dialog_empty")}
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
    // If the user cycled back to the derived baseline (checked ↔
    // unchecked ↔ checked over a label that was already checked
    // across the selection), drop the override so Apply doesn't
    // stay enabled for a no-op write.
    if (next === this._derivedState(labelId)) {
      map.delete(labelId);
    } else {
      map.set(labelId, next);
    }
    this._pendingChanges = map;
  }

  /** Block Esc / X / backdrop while a save is in flight so an
   *  in-flight set_labels_bulk write can't be orphaned by a stray
   *  dismissal. Mirrors the pattern used by onboarding-wifi-dialog
   *  and adopt-dialog. The footer's disabled Cancel button covers
   *  the explicit dismiss path; this covers the implicit ones. */
  private _onRequestClose = (e: Event) => {
    if (this._saving) {
      e.preventDefault();
    }
  };

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
        // Only close on full success; partial-failure keeps the
        // dialog open so the user can see which devices were
        // staged and re-Apply without re-staging their tri-state
        // edits. Matches the transport-failure branch below.
        this.close();
      } else {
        // Mirror the transport-failure branch: log the failed
        // configurations so the user can identify them in devtools
        // while the toast carries only the count (the dialog stays
        // open so they can also retry).
        console.warn(
          "set_labels_bulk partial failure:",
          failures.map((f) => ({ configuration: f.configuration, error: f.error }))
        );
        const key =
          failures.length === 1
            ? "dashboard.labels_bulk_save_failed_one"
            : "dashboard.labels_bulk_save_failed_other";
        toast.error(this._localize(key, { count: failures.length }), {
          richColors: true,
        });
      }
    } catch (err) {
      console.warn("set_labels_bulk failed", err);
      const key =
        count === 1
          ? "dashboard.labels_bulk_save_failed_one"
          : "dashboard.labels_bulk_save_failed_other";
      toast.error(this._localize(key, { count }), { richColors: true });
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
