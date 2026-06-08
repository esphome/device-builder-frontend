/**
 * "+ Add automation" wizard dialog.
 *
 * Mirrors the add-component flow: ask only for the mandatory
 * fields (target kind + component instance + trigger), save an
 * empty ``AutomationTree`` to the backend, then close and route
 * the navigator to the new section so the user lands in the
 * inline edit pane for the rest (actions, conditions inside an
 * if, …).
 *
 * Deliberately does NOT host the full automation editor — the
 * edit pane is the discoverable space for adding actions, and the
 * inline pane has the full width of the screen instead of the
 * dialog's 640px clamp.
 *
 * Emits ``automation-added`` (``detail: { sectionKey, yamlDiff }``)
 * on successful upsert so the parent navigator can switch to the
 * new section.
 */
import { consume } from "@lit/context";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import toast from "sonner-js";

import type { ESPHomeAPI } from "../../api/index.js";
import type {
  AutomationLocation,
  AutomationTree,
  AutomationTrigger,
  AvailableAutomations,
  AvailableComponentInstance,
  YamlDiff,
} from "../../api/types/automations.js";
import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import { getErrorMessage } from "../../util/error-message.js";
import { renderMarkdown } from "../../util/markdown.js";
import { parseYamlAutomations } from "../../util/yaml-sections.js";
import { addAutomationDialogStyles } from "./add-automation-dialog.styles.js";
import {
  firstSelectableTarget,
  scopeToContainer,
  triggersForComponent,
} from "./automation-editor/component-targets.js";
import { applyYamlDiff, sectionKeyFromLocation } from "./automation-editor/serialise.js";

/** Kinds the wizard can produce. Mirrors a subset of
 *  ``AutomationLocation``'s discriminator. The callable shapes
 *  (``script:``, ``api.actions:``) live behind their own
 *  dedicated dialogs, since the wizard's "what should this react
 *  to?" framing doesn't apply to them. */
export type AddAutomationKind = "device_on" | "component_on" | "interval";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "../base-dialog.js";
import "./automation-editor/component-target-picker.js";

type TargetKind = AddAutomationKind;

@customElement("esphome-add-automation-dialog")
export class ESPHomeAddAutomationDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property() boardName = "";

  @property() configuration = "";

  @property() yaml = "";

  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @state() private _open = false;

  @state() private _kind: TargetKind = "device_on";
  @state() private _componentId = "";
  /** The component id a per-section shortcut prefilled, kept so a
   *  multi-entity container can scope its picker to its own sub-entities
   *  even after the user picks one (which moves ``_componentId``). */
  @state() private _prefillComponentId = "";
  @state() private _triggerId: string | null = null;
  /** True when ``open()`` was called with a prefill — the dialog
   *  was launched from the per-section "+ Add automation" shortcut
   *  rather than the navigator's generic CTA. Hides the kind +
   *  component pickers so the user is only asked the one question
   *  the shortcut didn't already answer: which trigger? */
  @state() private _prefilled = false;
  /** Interval-only: numeric value the user typed. Paired with
   *  ``_intervalUnit`` to compose ``trigger_params.interval`` as
   *  "<value><unit>" on submit (mirrors the inline TIME_PERIOD
   *  renderer's storage shape). */
  @state() private _intervalValue = "";
  @state() private _intervalUnit: "us" | "ms" | "s" | "min" | "h" | "d" = "s";
  @state() private _available: AvailableAutomations | null = null;
  @state() private _loading = true;
  @state() private _saving = false;
  @state() private _error = "";

  static styles = [espHomeStyles, inputStyles, addAutomationDialogStyles];

  /**
   * Open the dialog. With no argument, behaves as the navigator's
   * "+ Add automation" CTA: kind defaults to ``device_on`` and the
   * user picks everything from scratch.
   *
   * With a ``prefill``, the dialog is launched from a per-section
   * shortcut (e.g. the "+ Add automation" button on a binary_sensor
   * instance or the esphome: section). The kind + component
   * pickers are hidden — the shortcut already answered those — and
   * only the trigger picker is shown.
   *
   * The prefill is a discriminated union so ``component_on``
   * always carries its ``componentId``: passing
   * ``{ kind: "component_on" }`` without an id would hide the
   * component picker AND block ``_canContinue`` (no instance to
   * scope the trigger to), making the dialog non-recoverable.
   */
  public open(
    prefill?: { kind: "device_on" } | { kind: "component_on"; componentId: string }
  ) {
    this._prefilled = prefill !== undefined;
    this._kind = prefill?.kind ?? "device_on";
    this._componentId = prefill?.kind === "component_on" ? prefill.componentId : "";
    this._prefillComponentId = this._componentId;
    this._triggerId = null;
    this._intervalValue = "";
    this._intervalUnit = "s";
    this._error = "";
    this._open = true;
    void this._loadAvailable();
  }

  // esphome-base-dialog never flips its own open on a user-driven close
  // (Escape / X / outside-click); the host owns _open here. The busy gate
  // (?busy=_saving) blocks dismissal while an upsert is in flight.
  private _onRequestClose = () => {
    this._open = false;
  };

  private async _loadAvailable() {
    if (!this._api || !this.configuration) return;
    this._loading = true;
    try {
      this._available = await this._api.getAvailableAutomations(this.configuration);
      // A per-section shortcut on a multi-entity container prefills the
      // container id, which has no triggers of its own; land on its first
      // sub-entity so the user sees a real target instead of an empty list.
      const container = this._prefillContainer();
      if (container) {
        this._componentId =
          this._available.devices.find((d) => d.parent_id === container.id)?.id ?? "";
      }
    } catch (err) {
      this._error = getErrorMessage(err);
    } finally {
      this._loading = false;
    }
  }

  /** The prefilled component when it's a multi-entity container (its
   *  triggers live on its sub-entities), else undefined. */
  private _prefillContainer(): AvailableComponentInstance | undefined {
    if (!this._prefilled || this._kind !== "component_on" || !this._prefillComponentId) {
      return undefined;
    }
    const d = this._available?.devices.find((x) => x.id === this._prefillComponentId);
    return d?.is_entity_container ? d : undefined;
  }

  protected render() {
    const title = this.boardName
      ? this._localize("device.add_automation_dialog_title", {
          name: this.boardName,
        })
      : this._localize("device.add_automation");
    return html`<esphome-base-dialog
      ?open=${this._open}
      ?busy=${this._saving}
      .label=${title}
      .confirmOnEnter=${this._onContinue}
      @request-close=${this._onRequestClose}
    >
      ${this._loading && !this._available
        ? html`<div style="text-align: center; padding: 32px;">
            <wa-spinner></wa-spinner>
          </div>`
        : this._renderForm()}
    </esphome-base-dialog>`;
  }

  private _renderForm() {
    const filteredTriggers = this._filteredTriggers();
    const triggerLocked = this._kind === "interval";
    // When prefilled, the shortcut already chose the kind (and, for
    // component_on, the component instance) — hide those rows so the
    // dialog reads as "pick a trigger" only. The remaining trigger
    // picker already filters by kind + componentId.
    const showKindRow = !this._prefilled;
    // A container prefill still needs the picker so the user can choose
    // which sub-entity the trigger attaches to (scoped to that container).
    const prefillContainer = this._prefillContainer();
    const showComponentRow =
      this._kind === "component_on" && (!this._prefilled || !!prefillContainer);
    return html`
      <p class="intro">
        ${renderMarkdown(this._localize("device.automation_header_description"))}
      </p>
      ${showKindRow
        ? html`<div class="field">
            <label class="field-label" id="kind-label">
              ${this._localize("device.automation_wizard_pick_target")}
            </label>
            <wa-select
              aria-labelledby="kind-label"
              value=${this._kind}
              ?disabled=${this._saving}
              @change=${(e: Event) =>
                this._onKindChange((e.target as HTMLSelectElement).value)}
            >
              <wa-option value="device_on" ?selected=${this._kind === "device_on"}>
                ${this._localize("device.automation_target_device")}
              </wa-option>
              <wa-option value="component_on" ?selected=${this._kind === "component_on"}>
                ${this._localize("device.automation_target_component")}
              </wa-option>
              <wa-option value="interval" ?selected=${this._kind === "interval"}>
                ${this._localize("device.automation_target_interval")}
              </wa-option>
            </wa-select>
          </div>`
        : nothing}
      ${showComponentRow ? this._renderComponentRow(prefillContainer) : nothing}
      ${this._kind === "interval" ? this._renderIntervalRow() : nothing}
      ${!triggerLocked ? this._renderTriggerRow(filteredTriggers) : nothing}
      ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
      <div class="actions">
        <button
          type="button"
          class="primary"
          ?disabled=${this._saving || !this._canContinue()}
          @click=${this._onContinue}
        >
          ${this._saving
            ? this._localize("device.adding")
            : this._localize("device.add_automation_continue")}
        </button>
      </div>
    `;
  }

  private _renderComponentRow(container?: AvailableComponentInstance) {
    // Scope the picker to one container's sub-entities when launched from
    // that component's section; otherwise offer every configured instance.
    const devices = scopeToContainer(this._available?.devices ?? [], container);
    return html`<esphome-component-target-picker
      .devices=${devices}
      .value=${this._componentId}
      ?disabled=${this._saving}
      @component-change=${(e: CustomEvent<{ componentId: string }>) =>
        this._onComponentChange(e.detail.componentId)}
    ></esphome-component-target-picker>`;
  }

  /**
   * Interval-only row: value + unit picker mirroring the inline
   * TIME_PERIOD renderer's UX. Asks for the time up front so the
   * user doesn't land in the editor with an empty interval block.
   */
  private _renderIntervalRow() {
    const units = ["us", "ms", "s", "min", "h", "d"] as const;
    return html`<div class="field">
      <label class="field-label" id="interval-label">
        ${this._localize("device.automation_interval_label")}
      </label>
      <div class="interval-inputs">
        <input
          type="text"
          inputmode="decimal"
          aria-labelledby="interval-label"
          .value=${this._intervalValue}
          placeholder="0"
          ?disabled=${this._saving}
          @input=${(e: Event) => {
            this._intervalValue = (e.target as HTMLInputElement).value;
          }}
        />
        <wa-select
          aria-label=${this._localize("device.automation_action_delay_unit")}
          ?disabled=${this._saving}
          @change=${(e: Event) => {
            this._intervalUnit = (e.target as HTMLSelectElement)
              .value as typeof this._intervalUnit;
          }}
        >
          ${units.map(
            (u) =>
              html`<wa-option value=${u} ?selected=${u === this._intervalUnit}
                >${this._localize(`device.automation_action_delay_unit_${u}`)}</wa-option
              >`
          )}
        </wa-select>
      </div>
    </div>`;
  }

  private _renderTriggerRow(triggers: AutomationTrigger[]) {
    if (triggers.length === 0) {
      return html`<p class="error">
        ${this._localize("device.automation_trigger_none_available")}
      </p>`;
    }
    const active = triggers.find((t) => t.id === this._triggerId);
    return html`<div class="field">
      <label class="field-label" id="trigger-label">
        ${this._localize("device.automation_wizard_pick_trigger")}
      </label>
      <wa-select
        aria-labelledby="trigger-label"
        value=${this._triggerId ?? ""}
        ?disabled=${this._saving}
        @change=${(e: Event) => (this._triggerId = (e.target as HTMLSelectElement).value)}
      >
        ${triggers.map(
          (t) =>
            html`<wa-option value=${t.id} ?selected=${t.id === this._triggerId}>
              ${t.name}
            </wa-option>`
        )}
      </wa-select>
      ${active?.description
        ? html`<p class="field-desc">${renderMarkdown(active.description)}</p>`
        : nothing}
    </div>`;
  }

  private _filteredTriggers(): AutomationTrigger[] {
    const all = this._available?.triggers ?? [];
    if (this._kind === "device_on") {
      // Device-level handlers fire once unless ESPHome accepts a list
      // (supports_list, e.g. multiple on_boot priorities); list-capable ones
      // stay offerable past the first and append an indexed entry.
      const takenDeviceTriggers = this._existingDeviceTriggers();
      return all.filter(
        (t) => t.is_device_level && (!takenDeviceTriggers.has(t.id) || t.supports_list)
      );
    }
    if (this._kind === "component_on") {
      const device = this._available?.devices.find((d) => d.id === this._componentId);
      // A component's inline ``on_*:`` fires once, so hide triggers that
      // already have a handler here; list-capable ones stay offerable.
      const takenComponentTriggers = this._existingComponentTriggers(this._componentId);
      return triggersForComponent(all, device).filter(
        (t) => !takenComponentTriggers.has(this._bareTrigger(t.id)) || t.supports_list
      );
    }
    return [];
  }

  /** Set of catalog trigger ids ("on_boot", "on_loop", …) that
   *  already have a handler under ``esphome:`` in the current
   *  draft YAML. Source: parseYamlAutomations — eventKey is the
   *  bare YAML key, which for device-level catalog entries is also
   *  the catalog id (no domain prefix). */
  private _existingDeviceTriggers(): Set<string> {
    const set = new Set<string>();
    for (const s of parseYamlAutomations(this.yaml)) {
      if (s.parentKey === "esphome" && s.eventKey) set.add(s.eventKey);
    }
    return set;
  }

  /** Bare YAML keys (``on_press`` / ``on_turn_on`` / …) that
   *  already have a handler on the given component instance. */
  private _existingComponentTriggers(componentId: string): Set<string> {
    const set = new Set<string>();
    for (const s of parseYamlAutomations(this.yaml)) {
      // ``id`` is the component instance id for inline component_on
      // entries (set in parseYamlAutomations); ``eventKey`` is the
      // bare ``on_*`` key. parentKey is the YAML domain ("switch")
      // — irrelevant here, the id+event pair is unique on its own.
      if (s.id === componentId && s.eventKey) set.add(s.eventKey);
    }
    return set;
  }

  /** Strip the ``<domain>.`` prefix off a component-level catalog
   *  trigger id (``switch.on_turn_on`` → ``on_turn_on``). The bare
   *  key is what shows up under the component instance in YAML. */
  private _bareTrigger(catalogId: string): string {
    const dot = catalogId.indexOf(".");
    return dot >= 0 ? catalogId.slice(dot + 1) : catalogId;
  }

  private _onKindChange(kind: string) {
    const k = kind as TargetKind;
    this._kind = k;
    this._triggerId = null;
    if (k === "component_on") {
      const devices = this._available?.devices ?? [];
      // A container isn't selectable (entity triggers go on its
      // sub-entities); default to the first real target.
      this._componentId = firstSelectableTarget(devices)?.id ?? "";
    } else {
      this._componentId = "";
    }
  }

  private _onComponentChange(id: string) {
    this._componentId = id;
    this._triggerId = null;
  }

  private _canContinue(): boolean {
    if (this._kind === "interval") return this._intervalValue.trim() !== "";
    if (!this._triggerId) return false;
    if (this._kind === "component_on" && !this._componentId) return false;
    return true;
  }

  private _onContinue = async () => {
    if (!this._api || !this._canContinue() || this._saving) return;
    this._saving = true;
    this._error = "";
    try {
      const location = this._buildLocation();
      const tree: AutomationTree = {
        trigger_id: this._catalogTriggerId(location),
        // Interval picks up the value+unit pair the user typed; for
        // device_on / component_on the trigger's own config_entries
        // are still empty at this point (filled in the inline editor
        // after the wizard closes).
        trigger_params:
          this._kind === "interval"
            ? { interval: `${this._intervalValue.trim()}${this._intervalUnit}` }
            : {},
        actions: [],
      };
      // Hand the backend our current draft yaml so the splice
      // lands relative to any pending edits the user hasn't saved
      // yet — matches the auto-apply path in the editor.
      const { yaml_diff } = await this._api.upsertAutomation(
        this.configuration,
        tree,
        location,
        this.yaml
      );
      this._dispatchAdded(location, yaml_diff);
      this._open = false;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : this._localize("device.automation_save_error");
      this._error = msg;
      toast.error(this._localize("device.automation_save_error"), {
        description: msg,
        richColors: true,
      });
    } finally {
      this._saving = false;
    }
  };

  private _buildLocation(): AutomationLocation {
    if (this._kind === "device_on") {
      // List-capable device triggers (supports_list, e.g. on_boot) append a
      // new indexed entry; the index is the existing handler count, so the
      // first lands at 0 (a one-item list) and later ones append.
      const trigger = this._available?.triggers.find((t) => t.id === this._triggerId);
      if (trigger?.supports_list) {
        const index = parseYamlAutomations(this.yaml).filter(
          (s) => s.parentKey === "esphome" && s.eventKey === this._triggerId
        ).length;
        return { kind: "device_on", trigger: this._triggerId!, index };
      }
      return { kind: "device_on", trigger: this._triggerId! };
    }
    if (this._kind === "component_on") {
      // Strip the ``<domain>.`` prefix to get the bare YAML key
      // the writer splices under the component. ``component_on``
      // catalog ids are always ``<domain>.<key>`` for non-device
      // triggers.
      const dotIdx = this._triggerId!.indexOf(".");
      const bare = dotIdx >= 0 ? this._triggerId!.slice(dotIdx + 1) : this._triggerId!;
      // List-capable triggers append a new indexed entry; an un-indexed
      // location would overwrite the block. Index = existing entry
      // count on this instance (mirrors the interval path).
      const trigger = this._available?.triggers.find((t) => t.id === this._triggerId);
      if (trigger?.supports_list) {
        const index = parseYamlAutomations(this.yaml).filter(
          (s) => s.id === this._componentId && s.eventKey === bare
        ).length;
        return {
          kind: "component_on",
          component_id: this._componentId,
          trigger: bare,
          index,
        };
      }
      return {
        kind: "component_on",
        component_id: this._componentId,
        trigger: bare,
      };
    }
    // interval — new blocks land at the end of the interval: list.
    // The backend treats an out-of-range index as "append" (in-range
    // as "replace"), so we have to pass the count of existing
    // intervals as the new entry's index. Hardcoding 0 here used to
    // overwrite the first interval whenever the device already had
    // one. Parse the current draft yaml (which carries any pending
    // edits the user hasn't saved yet) to count what's there.
    const nextIndex = parseYamlAutomations(this.yaml).filter(
      (s) => s.parentKey === "interval"
    ).length;
    return { kind: "interval", index: nextIndex };
  }

  /**
   * The catalog-qualified trigger id for the AutomationTree.
   * For ``device_on`` and ``interval`` this coincides with
   * ``location.trigger`` (or is ``null`` for interval); for
   * ``component_on`` it's the unprefixed ``this._triggerId``
   * (which IS the catalog id) since we only stripped the prefix
   * for the location field.
   */
  private _catalogTriggerId(location: AutomationLocation): string | null {
    if (location.kind === "interval") return null;
    return this._triggerId;
  }

  private _dispatchAdded(location: AutomationLocation, yamlDiff: YamlDiff) {
    // Apply the backend-emitted splice to the device's YAML
    // buffer so the new automation lands in the page's YAML state
    // (and thus the YAML pane + the global save button see the
    // change). The page listens to ``yaml-draft`` and advances
    // ``_yaml`` without touching ``_savedYaml`` — that's the
    // existing "dirty buffer, click Save to write" path.
    const newYaml = applyYamlDiff(this.yaml, yamlDiff);
    this.dispatchEvent(
      new CustomEvent<{ yaml: string }>("yaml-draft", {
        detail: { yaml: newYaml },
        bubbles: true,
        composed: true,
      })
    );
    this.dispatchEvent(
      new CustomEvent<{ sectionKey: string }>("automation-added", {
        detail: { sectionKey: sectionKeyFromLocation(location) },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-add-automation-dialog": ESPHomeAddAutomationDialog;
  }
}
