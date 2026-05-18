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
import {
  mdiClose,
  mdiContentSave,
  mdiDelete,
  mdiOpenInNew,
  mdiPlus,
  mdiScriptTextOutline,
} from "@mdi/js";

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

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";

registerMdiIcons({
  close: mdiClose,
  "content-save": mdiContentSave,
  delete: mdiDelete,
  "open-in-new": mdiOpenInNew,
  plus: mdiPlus,
  "script-text-outline": mdiScriptTextOutline,
});

/** One declared script parameter — captures the {name, type} pair
 *  that round-trips through ``triggerParams.parameters`` as a
 *  ``{name: type}`` map. Local to the editor since the wire shape
 *  is just the map. */
interface ParameterDecl {
  name: string;
  type: string;
}

/** ESPHome script run modes — see
 *  https://esphome.io/components/script.html#script-mode for each
 *  one's semantics. ``single`` is the default; the writer omits
 *  the mode key when set to single. */
const RUN_MODES = ["single", "restart", "queued", "parallel"] as const;

/** Parameter types supported by ESPHome's script: ``parameters:``
 *  block. The catalog already validates these on save, so we just
 *  pin the user to the same set here. */
const PARAM_TYPES = ["int", "float", "bool", "string"] as const;

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

  /**
   * Working list for the parameter editor. The wire shape is a
   * ``{name: type}`` dict (per ESPHome's YAML), which collapses
   * empty-name entries and can't represent two in-progress rows.
   * We keep an editable list locally and project named entries
   * down to the wire on each change; empty-name rows persist
   * locally until the user fills them in.
   */
  @state() private _params: ParameterDecl[] = [];


  public get inFlightWrite(): boolean {
    return this._saving || this._deleting;
  }

  static styles = [espHomeStyles, inputStyles, automationEditorStyles];

  connectedCallback(): void {
    super.connectedCallback();
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
    // Sync the local parameter list when ``value`` arrives from
    // outside (hydrate). We can't tell our own write from an
    // external mutation cleanly, so use a conservative check: if
    // the wire's named entries match what we have locally (minus
    // empty-name rows we're holding), don't disturb the local
    // state.
    if (changed.has("value")) {
      const fromWire = this._readParams(
        this.value ?? emptyAutomationTree(),
      );
      const localNamed = this._params.filter((p) => p.name);
      const matches =
        localNamed.length === fromWire.length &&
        localNamed.every(
          (p, i) =>
            p.name === fromWire[i].name && p.type === fromWire[i].type,
        );
      if (!matches) this._params = fromWire;
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
      ${this._renderIdField(disabled)}
      ${this._renderModeField(automation, disabled)}
      ${this._renderParametersField(automation, disabled)}
      <div class="field">
        <label class="field-label">
          ${this._localize("device.automation_action")}
        </label>
        <p class="field-description">
          ${renderMarkdown(
            this._localize("device.script_actions_description"),
          )}
        </p>
        <esphome-automation-action-list
          no-header
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
      </div>
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
   * Id field. Editable in both add-mode and edit-mode — renaming a
   * script via the input becomes a delete + insert on save. The
   * description warns the user that ``script.execute`` callers
   * still reference the old id and need to be updated separately.
   */
  private _renderIdField(disabled: boolean) {
    const id = this.location?.id ?? "";
    return html`<div class="field">
      <label class="field-label" for="script-id-input">
        ${this._localize("device.script_id_label")}
        <span class="required">*</span>
      </label>
      <p class="field-description">
        ${renderMarkdown(this._localize("device.script_id_description"))}
      </p>
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

  /**
   * Run-mode field. Single / restart / queued / parallel — see
   * the script docs for the semantic of each. Stored as
   * ``triggerParams.mode`` per the writer's contract.
   */
  private _renderModeField(automation: AutomationTree, disabled: boolean) {
    const mode = String(automation.trigger_params.mode ?? "single");
    return html`<div class="field">
      <label class="field-label">
        ${this._localize("device.automation_script_mode")}
      </label>
      <p class="field-description">
        ${renderMarkdown(this._localize("device.script_mode_description"))}
      </p>
      <wa-select
        value=${mode}
        ?disabled=${disabled}
        @change=${(e: Event) =>
          this._withValue({
            trigger_params: {
              ...automation.trigger_params,
              mode: (e.target as HTMLSelectElement).value,
            },
          })}
      >
        ${RUN_MODES.map(
          (m) => html`<wa-option value=${m} ?selected=${m === mode}
            >${m}</wa-option
          >`,
        )}
      </wa-select>
    </div>`;
  }

  /**
   * Declared parameter list. ``{name: type}`` map under
   * ``triggerParams.parameters``. Rendered as one row per declared
   * parameter with a remove button + a footer "+ Add parameter".
   */
  private _renderParametersField(
    _automation: AutomationTree,
    disabled: boolean,
  ) {
    const params = this._params;
    return html`<div class="field">
      <label class="field-label">
        ${this._localize("device.automation_script_parameters")}
      </label>
      <p class="field-description">
        ${renderMarkdown(
          this._localize("device.script_parameters_description"),
        )}
      </p>
      ${params.length === 0
        ? nothing
        : html`<div class="script-params-list">
            ${params.map((p, idx) =>
              this._renderParameterRow(p, idx, disabled),
            )}
          </div>`}
      <button
        type="button"
        class="script-param-add"
        ?disabled=${disabled}
        @click=${this._addParam}
      >
        <wa-icon library="mdi" name="plus"></wa-icon>
        ${this._localize("device.script_add_parameter")}
      </button>
    </div>`;
  }

  private _renderParameterRow(
    p: ParameterDecl,
    idx: number,
    disabled: boolean,
  ) {
    return html`<div class="script-param-row">
      <input
        type="text"
        ?disabled=${disabled}
        placeholder=${this._localize(
          "device.script_parameter_name_placeholder",
        )}
        .value=${p.name}
        @input=${(e: Event) =>
          this._updateParam(idx, {
            ...p,
            name: (e.target as HTMLInputElement).value,
          })}
      />
      <wa-select
        value=${p.type}
        ?disabled=${disabled}
        @change=${(e: Event) =>
          this._updateParam(idx, {
            ...p,
            type: (e.target as HTMLSelectElement).value,
          })}
      >
        ${PARAM_TYPES.map(
          (t) => html`<wa-option value=${t} ?selected=${t === p.type}
            >${t}</wa-option
          >`,
        )}
      </wa-select>
      <button
        type="button"
        class="script-param-remove"
        ?disabled=${disabled}
        aria-label=${this._localize("device.automation_remove")}
        @click=${() => this._removeParam(idx)}
      >
        <wa-icon library="mdi" name="close"></wa-icon>
      </button>
    </div>`;
  }

  private _readParams(automation: AutomationTree): ParameterDecl[] {
    const raw = automation.trigger_params.parameters;
    if (!raw || typeof raw !== "object") return [];
    return Object.entries(raw as Record<string, unknown>).map(
      ([name, type]) => ({ name, type: String(type ?? "string") }),
    );
  }

  /**
   * Push the local parameter list down to the wire. Empty-name
   * rows persist in the local state but are NOT written to the
   * wire dict (the wire shape is keyed by name and can't represent
   * unnamed in-progress entries). They become visible to the
   * writer only when the user fills the name in.
   */
  private _writeParams(list: ParameterDecl[]) {
    this._params = list;
    const dict: Record<string, string> = {};
    for (const { name, type } of list) {
      if (name) dict[name] = type;
    }
    const automation = this.value ?? emptyAutomationTree();
    this._withValue({
      trigger_params: { ...automation.trigger_params, parameters: dict },
    });
  }

  private _addParam = () => {
    this._writeParams([...this._params, { name: "", type: "int" }]);
  };

  private _updateParam(idx: number, value: ParameterDecl) {
    const list = this._params.slice();
    list[idx] = value;
    this._writeParams(list);
  }

  private _removeParam(idx: number) {
    const list = this._params.slice();
    list.splice(idx, 1);
    this._writeParams(list);
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
