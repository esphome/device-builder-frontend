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
import toast from "sonner-js";
import { mdiClose } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";

import type { ESPHomeAPI } from "../../api/index.js";
import type {
  AutomationLocation,
  AutomationTree,
  AvailableAutomations,
  AvailableComponentInstance,
  AutomationTrigger,
  BoardCatalogEntry,
  YamlDiff,
} from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { inputStyles } from "../../styles/inputs.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { renderMarkdown } from "../../util/markdown.js";
import { parseYamlAutomations } from "../../util/yaml-sections.js";
import {
  applyYamlDiff,
  sectionKeyFromLocation,
} from "./automation-editor/serialise.js";

/** Kinds the wizard can produce. Mirrors a subset of
 *  ``AutomationLocation``'s discriminator. The callable shapes
 *  (``script:``, ``api.actions:``) live behind their own
 *  dedicated dialogs, since the wizard's "what should this react
 *  to?" framing doesn't apply to them. */
export type AddAutomationKind =
  | "device_on"
  | "component_on"
  | "interval";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";

registerMdiIcons({ close: mdiClose });

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

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  @state() private _kind: TargetKind = "device_on";
  @state() private _componentId = "";
  @state() private _triggerId: string | null = null;
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

  static styles = [
    espHomeStyles,
    inputStyles,
    css`
      wa-dialog {
        --width: 560px;
      }
      wa-dialog::part(body) {
        padding: var(--wa-space-l);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
        margin-bottom: var(--wa-space-m);
      }
      .field-label {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-semibold);
        color: var(--wa-color-text-normal);
      }
      .field-desc {
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
        margin: 0;
      }
      .field-desc a {
        color: var(--wa-color-brand-fill-loud, #0b5cad);
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        margin-top: var(--wa-space-l);
      }
      .actions button {
        appearance: none;
        border: 1px solid transparent;
        padding: var(--wa-space-2xs) var(--wa-space-m);
        border-radius: var(--wa-border-radius-s);
        cursor: pointer;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-semibold);
      }
      .actions .primary {
        background: var(--wa-color-brand-fill-loud, #0b5cad);
        color: white;
      }
      .actions .primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .error {
        color: var(--esphome-error, #d92d20);
        font-size: var(--wa-font-size-2xs);
        margin-top: var(--wa-space-2xs);
      }
      .intro {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        margin: 0 0 var(--wa-space-m) 0;
        line-height: 1.5;
      }
      /* Interval-row pairing: matches the editor's inline
         TIME_PERIOD layout so the dialog reads as the same
         kind of compound input the user will see again in the
         section editor. */
      .interval-inputs {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
      }
      .interval-inputs > input {
        flex: 1 1 auto;
        min-width: 0;
      }
      .interval-inputs > wa-select {
        flex: 0 0 auto;
        min-width: 6rem;
      }
    `,
  ];

  public open() {
    this._kind = "device_on";
    this._componentId = "";
    this._triggerId = null;
    this._intervalValue = "";
    this._intervalUnit = "s";
    this._error = "";
    this._dialog.open = true;
    void this._loadAvailable();
  }

  private async _loadAvailable() {
    if (!this._api || !this.configuration) return;
    this._loading = true;
    try {
      this._available = await this._api.getAvailableAutomations(
        this.configuration,
      );
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loading = false;
    }
  }

  protected render() {
    const title = this.boardName
      ? this._localize("device.add_automation_dialog_title", {
          name: this.boardName,
        })
      : this._localize("device.add_automation");
    return html`<wa-dialog light-dismiss label=${title}>
      ${this._loading
        ? html`<div style="text-align: center; padding: 32px;">
            <wa-spinner></wa-spinner>
          </div>`
        : this._renderForm()}
    </wa-dialog>`;
  }

  private _renderForm() {
    const filteredTriggers = this._filteredTriggers();
    const componentLocked = this._kind !== "component_on";
    const triggerLocked = this._kind === "interval";
    return html`
      <p class="intro">
        ${renderMarkdown(this._localize("device.automation_header_description"))}
      </p>
      <div class="field">
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
      </div>
      ${this._kind === "component_on"
        ? this._renderComponentRow(componentLocked)
        : nothing}
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

  private _renderComponentRow(locked: boolean) {
    const devices = this._available?.devices ?? [];
    if (devices.length === 0) {
      return html`<p class="error">
        ${this._localize("device.automation_target_no_components")}
      </p>`;
    }
    return html`<div class="field">
      <label class="field-label" id="component-label">
        ${this._localize("device.automation_wizard_pick_component")}
      </label>
      <wa-select
        aria-labelledby="component-label"
        value=${this._componentId}
        ?disabled=${this._saving || locked}
        @change=${(e: Event) =>
          this._onComponentChange((e.target as HTMLSelectElement).value)}
      >
        ${devices.map(
          (d) => html`<wa-option value=${d.id} ?selected=${d.id === this._componentId}>
            ${d.name ?? d.id} (${d.component_id})
          </wa-option>`,
        )}
      </wa-select>
    </div>`;
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
            (u) => html`<wa-option
              value=${u}
              ?selected=${u === this._intervalUnit}
              >${this._localize(`device.automation_action_delay_unit_${u}`)}</wa-option
            >`,
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
        @change=${(e: Event) =>
          (this._triggerId = (e.target as HTMLSelectElement).value)}
      >
        ${triggers.map(
          (t) => html`<wa-option value=${t.id} ?selected=${t.id === this._triggerId}>
            ${t.name}
          </wa-option>`,
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
      // ESPHome's device-level lifecycle handlers (on_boot, on_loop,
      // on_shutdown, ...) can only appear once under ``esphome:``,
      // so once a handler exists the user adds more *actions* inside
      // it from the inline editor — they don't add another
      // automation. Hide those triggers from the picker.
      const takenDeviceTriggers = this._existingDeviceTriggers();
      return all.filter(
        (t) => t.is_device_level && !takenDeviceTriggers.has(t.id),
      );
    }
    if (this._kind === "component_on") {
      if (!this._componentId) return [];
      const device = this._available?.devices.find(
        (d) => d.id === this._componentId,
      );
      if (!device) return [];
      const [domain] = device.component_id.split(".");
      // Same rule for component-bound triggers: an inline ``on_*:``
      // block under a component only fires once, so don't offer
      // triggers that already have a handler on this instance.
      const takenComponentTriggers = this._existingComponentTriggers(
        this._componentId,
      );
      return all.filter(
        (t) =>
          !t.is_device_level &&
          (t.applies_to.includes(device.component_id) ||
            t.applies_to.includes(domain)) &&
          !takenComponentTriggers.has(this._bareTrigger(t.id)),
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
      this._componentId = devices[0]?.id ?? "";
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
        this.yaml,
      );
      this._dispatchAdded(location, yaml_diff);
      this._dialog.open = false;
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
      return { kind: "device_on", trigger: this._triggerId! };
    }
    if (this._kind === "component_on") {
      // Strip the ``<domain>.`` prefix to get the bare YAML key
      // the writer splices under the component. ``component_on``
      // catalog ids are always ``<domain>.<key>`` for non-device
      // triggers.
      const dotIdx = this._triggerId!.indexOf(".");
      const bare =
        dotIdx >= 0 ? this._triggerId!.slice(dotIdx + 1) : this._triggerId!;
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
      (s) => s.parentKey === "interval",
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
      }),
    );
    this.dispatchEvent(
      new CustomEvent<{ sectionKey: string }>("automation-added", {
        detail: { sectionKey: sectionKeyFromLocation(location) },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-add-automation-dialog": ESPHomeAddAutomationDialog;
  }
}
