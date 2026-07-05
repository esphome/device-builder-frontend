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
import { mdiCheck, mdiMinus } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import memoizeOne from "memoize-one";
import type { ESPHomeAPI } from "../../api/index.js";
import type { ConfiguredDevice, Label } from "../../api/types/devices.js";
import type { LocalizeFunc } from "../../common/localize.js";
import {
  apiContext,
  devicesContext,
  labelsContext,
  localizeContext,
} from "../../context/index.js";
import { dialogActionButtonStyles } from "../../styles/dialog-action-buttons.js";
import { dialogChromeStyles } from "../../styles/dialog-chrome.js";
import { espHomeStyles } from "../../styles/shared.js";
import { labelChipStyles, renderLabelChip } from "../../util/label-chip-template.js";
import { notifyError, notifyInfo, notifySuccess } from "../../util/notify.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import "../base-dialog.js";
import { labelsListStyles } from "./labels-list-styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  check: mdiCheck,
  minus: mdiMinus,
});

export type TriState = "checked" | "unchecked" | "indeterminate";

function _setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

@customElement("esphome-bulk-labels-dialog")
export class ESPHomeBulkLabelsDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext, subscribe: true })
  @state()
  private _api?: ESPHomeAPI;

  @consume({ context: labelsContext, subscribe: true })
  @state()
  private _catalog: Label[] = [];

  /** Live device list from app-shell. Subscribed so a
   *  ``device_updated`` event mid-dialog rebinds device objects
   *  and ``_derivedState`` / ``_onToggle`` see fresh labels. */
  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _allDevices: ConfiguredDevice[] = [];

  /** Configuration ids the dashboard selected when opening the
   *  dialog. The actual ``ConfiguredDevice`` objects are looked
   *  up from ``_allDevices`` on each access so they stay current
   *  if a ``device_updated`` event lands while we're open (e.g.
   *  after a partial-failure Apply where some devices succeed
   *  and the backend re-emits with new labels). */
  @property({ attribute: false })
  configurations: string[] = [];

  /** Memoised filter of ``_allDevices`` down to the selected
   *  ``configurations``. Reference-stable on the same inputs so
   *  ``render()`` (which reads ``devices.length`` twice) +
   *  ``computeUpdates`` don't re-run the filter on every render. */
  private _filterDevices = memoizeOne(
    (allDevices: ConfiguredDevice[], configurations: string[]) => {
      const targets = new Set(configurations);
      return allDevices.filter((d) => targets.has(d.configuration));
    }
  );

  get devices(): ConfiguredDevice[] {
    return this._filterDevices(this._allDevices, this.configurations);
  }

  /** Reactive ``open`` flag bound to ``<esphome-base-dialog>``.
   *  Imperative ``open()`` flips this to true; ``@after-hide``
   *  flips it back to false after any dismiss path. */
  @state()
  private _open = false;

  /** Per-label explicit user transitions. Absence means "leave
   *  derived state as-is on Apply" (no change to any device). */
  @state()
  private _pendingChanges: Map<string, "checked" | "unchecked"> = new Map();

  @state()
  private _saving = false;

  /** Monotonic counter incremented on every ``open()``. ``_apply``
   *  snapshots the value before its WS round-trip and bails out
   *  of the success/failure branches if the counter has advanced
   *  by the time the promise resolves — i.e. the dialog was
   *  closed and re-opened with a different selection while a save
   *  was in flight. The wrapper's busy gate prevents most paths
   *  from getting there in the first place; this is defense in
   *  depth for any programmatic close that bypasses the wrapper. */
  private _applyGeneration = 0;

  /** Set of configurations the previous Apply failed on. Null
   *  means "no prior failure; target the full selection."
   *  Non-null narrows the next Apply to only this subset so a
   *  retry doesn't re-write devices that already succeeded.
   *  Reset on ``open()``, on a fully-successful Apply, and on
   *  any new ``_onToggle`` (a fresh edit expresses new intent,
   *  not a retry). */
  @state()
  private _failedConfigurations: Set<string> | null = null;

  /** Open the dialog. Resets per-session state so a previous
   *  session's pending changes / retry-narrow / in-flight
   *  ``_saving`` flag don't leak. Bumps ``_applyGeneration`` so
   *  a still-pending ``_apply`` from the previous session can
   *  detect it landed on a different dialog instance and bail. */
  open() {
    this._pendingChanges = new Map();
    this._failedConfigurations = null;
    this._saving = false;
    this._applyGeneration++;
    this._open = true;
  }

  // Arrow property so the Cancel button's ``@click=${this.close}``
  // captures a bound reference; a plain method would lose ``this``
  // when Lit re-dispatches the event.
  close = () => {
    this._open = false;
  };

  /** ``<esphome-base-dialog>`` re-emits ``after-hide`` for every
   *  dismissal path (Esc / outside-click / X / reactive ``?open``
   *  flip). Keep our local flag in sync so the next render's
   *  ``?open`` matches the wrapper's state. */
  private _onAfterHide = () => {
    this._open = false;
  };

  protected updated(changed: Map<string, unknown>) {
    if (this._pendingChanges.size === 0) return;
    // Reconcile ``_pendingChanges`` against the live catalog: if
    // a label was deleted elsewhere (another tab, the single-device
    // editor's delete flow) while the dialog was open, drop any
    // pending transition for the now-missing id. Otherwise the
    // payload would include an id the backend no longer knows
    // and surface as a per-device failure with no UI affordance
    // for the user to clear it (the row is already gone from
    // the catalog list).
    //
    // Second pass on ``_allDevices`` shifts: if a ``device_updated``
    // event lands while we're open and slides a label's derived
    // state up to match an existing pending override (e.g. another
    // tab applied the same change), the override is now a no-op
    // but stays in the map; Apply would stay enabled and fall
    // through to the "no changes" branch. Drop it here to mirror
    // the ``_onToggle`` cycle-back cleanup.
    const validIds = new Set(this._catalog.map((l) => l.id));
    const map = new Map(this._pendingChanges);
    let mutated = false;
    const catalogChanged = changed.has("_catalog");
    const devicesChanged = changed.has("_allDevices");
    for (const [id, change] of map) {
      if (catalogChanged && !validIds.has(id)) {
        map.delete(id);
        mutated = true;
        continue;
      }
      if (devicesChanged && change === this._derivedState(id)) {
        map.delete(id);
        mutated = true;
      }
    }
    if (mutated) this._pendingChanges = map;
  }

  /** Per-label count of selected devices that carry that label.
   *  Composes on top of ``_filterDevices`` rather than re-scanning
   *  ``_allDevices`` itself: ``this.devices`` is already a
   *  reference-stable filtered list (memoize-one above), so passing
   *  it in lets this memo cache on that same reference and avoids a
   *  second full-list scan per render. ``validCount`` falls out
   *  naturally from ``filteredDevices.length``. */
  private _computeLabelCounts = memoizeOne((filteredDevices: ConfiguredDevice[]) => {
    const counts = new Map<string, number>();
    for (const device of filteredDevices) {
      for (const id of device.labels ?? []) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  });

  /** Derived tri-state for a label across the current device set. */
  private _derivedState(labelId: string): TriState {
    const filtered = this.devices;
    if (filtered.length === 0) return "unchecked";
    const has = this._computeLabelCounts(filtered).get(labelId) ?? 0;
    if (has === filtered.length) return "checked";
    if (has === 0) return "unchecked";
    return "indeterminate";
  }

  /** Effective state for rendering: pending override wins, else derived. */
  effectiveState(labelId: string): TriState {
    const pending = this._pendingChanges.get(labelId);
    if (pending !== undefined) return pending;
    return this._derivedState(labelId);
  }

  /** Compute the per-device updates payload the Apply button would send.
   *
   *  Two filters compose:
   *  - After a partial failure, ``_failedConfigurations`` narrows to
   *    only the configs that failed last Apply (avoids re-writing
   *    devices that already succeeded).
   *  - The diff filter drops devices whose resulting labels set is
   *    byte-identical to their current ``device.labels`` so no-op
   *    writes don't go on the wire (also makes the success-toast
   *    count reflect actual changes).
   *
   *  Exposed (not just inlined into ``_apply``) so the test suite
   *  can drive selection state and assert the resulting payload
   *  without mounting the API client. */
  computeUpdates(): Array<{ configuration: string; labelIds: string[] }> {
    const failed = this._failedConfigurations;
    const targets = failed
      ? this.devices.filter((d) => failed.has(d.configuration))
      : this.devices;
    return targets.flatMap((device) => {
      const before = new Set(device.labels ?? []);
      const after = new Set(before);
      for (const [labelId, change] of this._pendingChanges) {
        if (change === "checked") after.add(labelId);
        else after.delete(labelId);
      }
      if (_setsEqual(before, after)) return [];
      return [{ configuration: device.configuration, labelIds: [...after] }];
    });
  }

  /** True if the user has made any explicit transition (the Apply
   *  button is enabled only when there's something to apply). */
  get _hasPendingChanges(): boolean {
    return this._pendingChanges.size > 0;
  }

  /** Apply is reachable (button enabled, Enter armed) only with staged
   *  changes and no in-flight save. */
  get _canApply(): boolean {
    return this._hasPendingChanges && !this._saving;
  }

  static styles = [
    espHomeStyles,
    labelChipStyles,
    labelsListStyles,
    dialogActionButtonStyles,
    // Neutral header + title + footer (shared) — dialog-chrome.ts.
    dialogChromeStyles,
    css`
      :host {
        display: contents;
      }

      esphome-base-dialog {
        --width: min(480px, 92vw);
      }

      /* Bottom padding is --wa-space-m here (vs --wa-space-l elsewhere) — see #600. */
      esphome-base-dialog::part(body) {
        padding: 0 var(--wa-space-l) var(--wa-space-m);
      }

      /* Cap the list height so the dialog fits short mobile
         viewports without clipping the inline actions row. */
      .options {
        max-height: 60vh;
      }

      /* Inline action row at the end of the body — the project
         convention (see base-dialog.ts docstring); the wrapper
         doesn't expose a footer slot. Border-top + padding-top
         visually separate the actions from the picker above. */
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        margin-top: var(--wa-space-m);
        padding-top: var(--wa-space-m);
        border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
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
    // After a partial-failure retry narrows ``_failedConfigurations``,
    // ``computeUpdates`` filters down to that subset, so the title
    // count tracks the retry target (not the original selection).
    // Otherwise the user sees "Labels for 5 devices" while the next
    // Apply only re-writes the 2 that failed — looks like a bug.
    const targetCount = this._failedConfigurations?.size ?? this.devices.length;
    return html`
      <esphome-base-dialog
        ?open=${this._open}
        ?busy=${this._saving}
        .label=${this._localize("dashboard.labels_bulk_dialog_title", {
          count: targetCount,
        })}
        .confirmOnEnter=${this._canApply ? this._apply : undefined}
        @after-hide=${this._onAfterHide}
      >
        ${
          this._catalog.length === 0
            ? html`<div class="option-empty" role="status">
                ${this._localize("dashboard.labels_bulk_dialog_empty")}
              </div>`
            : html`<div
                class="options"
                role="group"
                aria-label=${this._localize("dashboard.labels_bulk_group_aria")}
              >
                ${repeat(
                  this._catalog,
                  (label) => label.id,
                  (label) => this._renderOption(label)
                )}
              </div>`
        }
        <div class="actions">
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
            ?disabled=${!this._canApply}
            @click=${this._apply}
          >
            ${this._localize("dashboard.labels_bulk_apply")}
          </button>
        </div>
      </esphome-base-dialog>
    `;
  }

  private _renderOption(label: Label) {
    // ``triState`` avoids shadowing the ``state`` decorator import.
    const triState = this.effectiveState(label.id);
    const checked = triState === "checked";
    const mixed = triState === "indeterminate";
    const ariaChecked = checked ? "true" : mixed ? "mixed" : "false";
    // Row-level title owns the tooltip for the whole row: the chip
    // below opts out via ``suppressTitle`` so hovering chip vs.
    // button background doesn't show two different tooltips on the
    // same row. Mixed rows extend the title with the supplementary
    // hint; non-mixed rows still get the label name.
    return html`<button
      class="option"
      type="button"
      role="checkbox"
      aria-checked=${ariaChecked}
      title=${
        mixed
          ? this._localize("dashboard.labels_bulk_mixed_title", {
              name: label.name,
            })
          : label.name
      }
      @click=${() => this._onToggle(label.id)}
    >
      <span
        class="option-check ${
          checked ? "option-check--checked" : mixed ? "option-check--mixed" : ""
        }"
      >
        ${
          checked
            ? html`<wa-icon library="mdi" name="check"></wa-icon>`
            : mixed
              ? html`<wa-icon library="mdi" name="minus"></wa-icon>`
              : nothing
        }
      </span>
      ${renderLabelChip(label, { suppressTitle: true })}
    </button>`;
  }

  private _onToggle(labelId: string) {
    const current = this.effectiveState(labelId);
    const derived = this._derivedState(labelId);
    const map = new Map(this._pendingChanges);
    // Indeterminate-derived rows: cycle is indeterminate -> checked
    // -> unchecked -> indeterminate. The third click clears pending
    // so the user has a path back to "leave each device alone"
    // without scrapping their other staged edits via Cancel. The
    // checked- and unchecked-derived rows already get this via the
    // ``next === derived`` shortcut below; indeterminate can't fall
    // out of that path because ``next`` is binary.
    if (derived === "indeterminate" && current === "unchecked") {
      map.delete(labelId);
      this._pendingChanges = map;
      this._failedConfigurations = null;
      return;
    }
    // ``checked`` → ``unchecked``; everything else → ``checked``.
    // The "indeterminate → checked" rule mirrors Gmail / GitHub
    // multi-select label semantics (one click "claims" the label
    // for every device; a second removes it from every device).
    const next: "checked" | "unchecked" = current === "checked" ? "unchecked" : "checked";
    // If the user cycled back to the derived baseline (checked ↔
    // unchecked ↔ checked over a label that was already checked
    // across the selection), drop the override so Apply doesn't
    // stay enabled for a no-op write.
    if (next === derived) {
      map.delete(labelId);
    } else {
      map.set(labelId, next);
    }
    this._pendingChanges = map;
    // A new edit after a partial failure expresses fresh user intent
    // ("apply this label across the WHOLE selection"), not a retry
    // of the prior payload. Clear the retry-narrow so the next Apply
    // targets every selected device again; otherwise devices that
    // succeeded last time would silently miss the new transition.
    this._failedConfigurations = null;
  }

  private _apply = async () => {
    // Re-entrancy guard: a quick double-click on Apply could fire
    // two ``_apply`` calls before the Lit re-render disables the
    // button via ``_saving``. Drop the second call here so we don't
    // send two ``set_labels_bulk`` requests for the same payload.
    if (!this._canApply) return;
    const updates = this.computeUpdates();
    const count = updates.length;
    if (count === 0) {
      // ``_hasPendingChanges`` is true but every transition is a
      // no-op against the current device labels (e.g. another tab
      // applied the same change in the interim, or the catalog
      // reconcile dropped the last remaining entry). Acknowledge
      // the click with an info toast so the dialog vanishing
      // doesn't read as a failed action, then clear pending state.
      notifyInfo(this._localize("dashboard.labels_bulk_no_changes"));
      this._pendingChanges = new Map();
      this._failedConfigurations = null;
      this.close();
      return;
    }
    // Snapshot the generation so a stale response (dialog closed +
    // re-opened with a different selection mid-flight) bails out
    // before mutating state or firing toasts that would apply to
    // the new session.
    const gen = this._applyGeneration;
    this._saving = true;
    try {
      // The context provider is always wired in production; an
      // unreachable null here would have silently produced a
      // dead-click Apply button before. Routing it through the
      // catch makes the (admittedly edge-case) failure surface
      // with the same bulk-failure toast as a transport error.
      if (!this._api) throw new Error("apiContext provider missing");
      const results = await this._api.setDeviceLabelsBulk(updates);
      if (gen !== this._applyGeneration) return;
      const failures = results.filter((r) => !r.success);
      if (failures.length === 0) {
        notifySuccess(this._localize("dashboard.labels_bulk_saved", { count }));
        // Full success clears the retry-narrow filter so a future
        // re-open via the bulk button would target the whole new
        // selection rather than the previous failure subset.
        this._failedConfigurations = null;
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
        // Narrow the next Apply to only the failed configurations
        // so a retry doesn't re-write the devices that already
        // succeeded (idempotent backend-side but wastes round
        // trips + audit-log entries).
        this._failedConfigurations = new Set(failures.map((f) => f.configuration));
        // Acknowledge the successes too — a 8/10-succeeded outcome
        // reads as "nothing worked" if only the failure toast
        // fires. The dashboard's rows visibly flip for the
        // succeeded devices so the two toasts together match what
        // the user is seeing.
        const succeeded = count - failures.length;
        if (succeeded > 0) {
          notifySuccess(
            this._localize("dashboard.labels_bulk_saved", { count: succeeded })
          );
        }
        notifyError(
          this._localize("dashboard.labels_bulk_save_failed", {
            count: failures.length,
          })
        );
      }
    } catch (err) {
      if (gen !== this._applyGeneration) return;
      console.warn("set_labels_bulk failed", err);
      notifyError(this._localize("dashboard.labels_bulk_save_failed", { count }));
    } finally {
      // Only clear ``_saving`` if we're still the active session —
      // a generation bump means a new ``open()`` call already reset
      // local state and shouldn't have ``_saving`` clobbered by
      // our late finally.
      if (gen === this._applyGeneration) this._saving = false;
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-bulk-labels-dialog": ESPHomeBulkLabelsDialog;
  }
}
