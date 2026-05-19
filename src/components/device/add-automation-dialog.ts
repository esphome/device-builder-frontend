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
import {
  applyYamlDiff,
  sectionKeyFromLocation,
} from "./automation-editor/serialise.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";

registerMdiIcons({ close: mdiClose });

type TargetKind = "device_on" | "component_on" | "interval";

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
    `,
  ];

  public open() {
    this._kind = "device_on";
    this._componentId = "";
    this._triggerId = null;
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
      return all.filter((t) => t.is_device_level);
    }
    if (this._kind === "component_on") {
      if (!this._componentId) return [];
      const device = this._available?.devices.find(
        (d) => d.id === this._componentId,
      );
      if (!device) return [];
      const [domain] = device.component_id.split(".");
      return all.filter(
        (t) =>
          !t.is_device_level &&
          (t.applies_to.includes(device.component_id) ||
            t.applies_to.includes(domain)),
      );
    }
    return [];
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
    if (this._kind === "interval") return true;
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
        trigger_params: {},
        actions: [],
      };
      const { yaml_diff } = await this._api.upsertAutomation(
        this.configuration,
        tree,
        location,
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
    // interval — newly added blocks always land at the end of the
    // interval: list, so the backend's writer appends and we pin
    // index to the length of any existing intervals (the writer
    // is responsible for the actual index — we just need to pass
    // a valid number; using 0 makes the writer "first item" if
    // the list is empty, otherwise the writer appends).
    return { kind: "interval", index: 0 };
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
