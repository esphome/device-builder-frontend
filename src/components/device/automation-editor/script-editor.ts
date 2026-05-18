/**
 * Top-level script editor — the structured form for a single
 * ``script:`` block in the device YAML.
 *
 * Scripts are reusable callable bodies, not triggered automations.
 * They carry their own identity (``id``), execution mode
 * (``single`` / ``restart`` / ``queued`` / ``parallel``), declared
 * parameters, and a body that is a list of actions. They share the
 * recursive action-list component with ``<esphome-automation-editor>``
 * but live in their own surface because the chrome differs: scripts
 * have an id+mode header, no trigger, no condition gate at the top.
 *
 * Same public-surface conventions as the automation editor:
 *
 * - ``addMode`` distinguishes the wizard mount (id input + save into
 *   a new section) from the navigator-routed edit mount (id locked,
 *   value hydrated from the backend).
 * - Save / delete are optimistic + revert-on-failure (toast.error on
 *   failure); the editor's ``inFlightWrite`` guard signals to the
 *   parent's reconnect handler to skip clobbering an in-flight
 *   write.
 */
import { consume } from "@lit/context";
import toast from "sonner-js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { mdiContentSave, mdiDelete, mdiOpenInNew, mdiScriptTextOutline } from "@mdi/js";

import type { ESPHomeAPI } from "../../../api/index.js";
import type {
  AutomationLocation,
  AutomationTree,
  AvailableAutomations,
  BoardCatalogEntry,
  YamlDiff,
} from "../../../api/types.js";

/** ``AutomationLocation`` variant for top-level ``script:`` blocks
 *  — pulled out as a separate type because the script editor only
 *  ever holds this kind. */
type ScriptLocation = Extract<AutomationLocation, { kind: "script" }>;
import type { LocalizeFunc } from "../../../common/localize.js";
import { apiContext, localizeContext } from "../../../context/index.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { inputStyles } from "../../../styles/inputs.js";
import { registerMdiIcons } from "../../../util/register-icons.js";
import { renderMarkdown } from "../../../util/markdown.js";
import { automationEditorStyles } from "./automation-editor.styles.js";
import {
  emptyAutomationTree,
  sectionKeyFromLocation,
} from "./serialise.js";
import "./automation-action-list.js";
import "./automation-script-params.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";

registerMdiIcons({
  "content-save": mdiContentSave,
  delete: mdiDelete,
  "open-in-new": mdiOpenInNew,
  "script-text-outline": mdiScriptTextOutline,
});

@customElement("esphome-script-editor")
export class ESPHomeScriptEditor extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property() configuration = "";

  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @property() platform = "";

  @property({ attribute: false })
  value: AutomationTree | null = null;

  @property({ attribute: false })
  location: ScriptLocation | null = null;

  /** True when mounted from the "+ Add script" wizard. Add-mode
   *  lets the user type the id; edit-mode locks it. */
  @property({ type: Boolean, attribute: "add-mode" })
  addMode = false;

  @property() yaml = "";

  @state() private _available: AvailableAutomations | null = null;
  @state() private _loading = true;
  @state() private _saving = false;
  @state() private _deleting = false;
  @state() private _error = "";

  /** Snapshot of add-vs-edit at mount so hydrate doesn't flip the
   *  id picker back to unlocked. */
  @state() private _editMode = false;

  public get inFlightWrite(): boolean {
    return this._saving || this._deleting;
  }

  static styles = [espHomeStyles, inputStyles, automationEditorStyles];

  connectedCallback(): void {
    super.connectedCallback();
    this._editMode = !this.addMode;
    void this._load();
  }

  protected updated(changed: Map<string, unknown>) {
    if (changed.has("configuration")) {
      void this._loadAvailable();
    }
    if (
      !this.addMode &&
      (changed.has("location") ||
        changed.has("configuration") ||
        changed.has("_loading")) &&
      this.location &&
      this.value === null &&
      !this._loading
    ) {
      void this._hydrateFromBackend();
    }
  }

  private async _load() {
    if (!this._api) return;
    this._loading = true;
    this._error = "";
    try {
      if (this.configuration) await this._loadAvailable();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loading = false;
    }
  }

  private async _loadAvailable() {
    if (!this._api || !this.configuration) return;
    try {
      this._available = await this._api.getAvailableAutomations(
        this.configuration,
      );
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    }
  }

  private async _hydrateFromBackend() {
    if (!this._api || !this.configuration || !this.location) return;
    try {
      const parsed = await this._api.parseDeviceAutomations(this.configuration);
      const wantKey = sectionKeyFromLocation(this.location);
      const match = parsed.find(
        (p) => sectionKeyFromLocation(p.location) === wantKey,
      );
      if (match && match.location.kind === "script") {
        this.value = match.automation;
        this.location = match.location;
      }
    } catch (err) {
      this._error =
        err instanceof Error
          ? err.message
          : this._localize("device.automation_parse_error");
    }
  }

  protected render() {
    if (this._loading) {
      return html`<div class="ae-empty">
        <wa-spinner></wa-spinner>
        ${this._localize("device.loading_automation_catalog")}
      </div>`;
    }
    const automation = this.value ?? emptyAutomationTree();
    const devices = this._available?.devices ?? [];
    const scripts = this._available?.scripts ?? [];
    const actions = this._available?.actions ?? [];
    const conditions = this._available?.conditions ?? [];
    const disabled = this._saving || this._deleting;
    return html`
      ${this._renderHeader()}
      ${this._renderIdRow(disabled)}
      <esphome-automation-script-params
        .target=${this.location}
        .triggerParams=${automation.trigger_params}
        ?disabled=${disabled}
        @script-params-change=${this._onScriptParamsChange}
      ></esphome-automation-script-params>
      <esphome-automation-action-list
        .actions=${automation.actions}
        .catalog=${actions}
        .conditionCatalog=${conditions}
        .scripts=${scripts}
        .devices=${devices}
        .board=${this.board}
        .yaml=${this.yaml}
        ?disabled=${disabled}
        @actions-change=${this._onActionsChange}
      ></esphome-automation-action-list>
      ${this._error
        ? html`<p class="ae-error" role="alert">${this._error}</p>`
        : nothing}
      <div class="ae-actions">
        <button
          type="button"
          class="ae-primary"
          ?disabled=${disabled || !this._canSave()}
          @click=${this._onSave}
        >
          <wa-icon library="mdi" name="content-save"></wa-icon>
          ${this._saving
            ? this._localize("device.saving")
            : this.addMode
              ? this._localize("device.add_script")
              : this._localize("dashboard.save")}
        </button>
        ${this.location && this.value && !this.addMode
          ? html`<button
              type="button"
              class="ae-danger"
              ?disabled=${disabled}
              @click=${this._onDelete}
            >
              <wa-icon library="mdi" name="delete"></wa-icon>
              ${this._localize("dashboard.delete")}
            </button>`
          : nothing}
      </div>
    `;
  }

  /**
   * Component-style header card. In edit-mode this is the section's
   * identity at a glance: the script id, a short description of
   * what scripts are, and a docs link to the ESPHome reference.
   * In add-mode the header is more generic ("New script") since the
   * id isn't picked yet.
   */
  private _renderHeader() {
    const id = this.location?.id || "";
    return html`<div class="ae-header">
      <div class="ae-header-text">
        <h2 class="ae-header-title">
          ${this.addMode
            ? this._localize("device.add_script")
            : id
              ? this._localize("device.script_header_title", { id })
              : this._localize("device.add_script")}
        </h2>
        <a
          class="ae-header-docs"
          href="https://esphome.io/components/script.html"
          target="_blank"
          rel="noreferrer"
        >
          ${this._localize("device.docs")}
          <wa-icon library="mdi" name="open-in-new"></wa-icon>
        </a>
        <p class="ae-header-desc">
          ${renderMarkdown(this._localize("device.script_header_description"))}
        </p>
      </div>
      <div class="ae-header-icon">
        <wa-icon library="mdi" name="script-text-outline"></wa-icon>
      </div>
    </div>`;
  }

  /**
   * Id row. In add-mode this is an editable text input — the user
   * names the script before it can be saved. In edit-mode the id is
   * pinned (changing it would move the YAML splice destination, an
   * operation we don't support inline) so render it as a read-only
   * label.
   */
  private _renderIdRow(disabled: boolean) {
    const id = this.location?.id ?? "";
    if (this._editMode) {
      return html`<div class="ae-section">
        <label class="ae-section-label">
          ${this._localize("device.automation_target_script_label")}
        </label>
        <p class="ae-section-desc">${id}</p>
      </div>`;
    }
    return html`<div class="ae-section">
      <label class="ae-section-label" for="script-id-input">
        ${this._localize("device.automation_target_script_new_id_label")}
      </label>
      <input
        id="script-id-input"
        type="text"
        .value=${id}
        placeholder=${this._localize(
          "device.automation_target_script_id_placeholder",
        )}
        ?disabled=${disabled}
        @input=${this._onIdInput}
      />
    </div>`;
  }

  private _onIdInput = (e: Event) => {
    const id = (e.target as HTMLInputElement).value.trim();
    this.location = { kind: "script", id };
    this.dispatchEvent(
      new CustomEvent("automation-change", {
        detail: { value: this.value, location: this.location },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onScriptParamsChange = (
    e: CustomEvent<{ triggerParams: Record<string, unknown> }>,
  ) => {
    e.stopPropagation();
    this._withValue({ trigger_params: e.detail.triggerParams });
  };

  private _onActionsChange = (
    e: CustomEvent<{ actions: AutomationTree["actions"] }>,
  ) => {
    e.stopPropagation();
    this._withValue({ actions: e.detail.actions });
  };

  private _withValue(patch: Partial<AutomationTree>) {
    const value: AutomationTree = {
      ...(this.value ?? emptyAutomationTree()),
      ...patch,
    };
    this.value = value;
    this.dispatchEvent(
      new CustomEvent("automation-change", {
        detail: { value, location: this.location },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _canSave(): boolean {
    if (!this.location) return false;
    return !!this.location.id;
  }

  private _onSave = async () => {
    if (!this._api || !this.location || this._saving || !this._canSave()) return;
    const value = this.value ?? emptyAutomationTree();
    this._saving = true;
    this._error = "";
    try {
      const { yaml_diff } = await this._api.upsertAutomation(
        this.configuration,
        value,
        this.location,
      );
      this.dispatchEvent(
        new CustomEvent<{
          yamlDiff: YamlDiff;
          value: AutomationTree;
          location: AutomationLocation;
        }>("automation-save", {
          detail: { yamlDiff: yaml_diff, value, location: this.location },
          bubbles: true,
          composed: true,
        }),
      );
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

  private _onDelete = async () => {
    if (!this._api || !this.location || this._deleting) return;
    this._deleting = true;
    this._error = "";
    try {
      const { yaml_diff } = await this._api.deleteAutomation(
        this.configuration,
        this.location,
      );
      this.dispatchEvent(
        new CustomEvent<{ yamlDiff: YamlDiff; location: AutomationLocation }>(
          "automation-delete",
          {
            detail: { yamlDiff: yaml_diff, location: this.location },
            bubbles: true,
            composed: true,
          },
        ),
      );
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
      this._deleting = false;
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-script-editor": ESPHomeScriptEditor;
  }
}
