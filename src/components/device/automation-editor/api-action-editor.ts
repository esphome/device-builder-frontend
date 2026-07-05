/**
 * Top-level editor for one ``api.actions:`` entry — a Home
 * Assistant-callable action exposed by the device's ``api:`` block.
 *
 * Structurally a slim sibling of ``<esphome-script-editor>``: a
 * named callable with typed ``variables:`` (instead of ``parameters:``)
 * and a ``then:`` action list, no trigger. The api component has no
 * per-action catalog entry, so the editor doesn't drive the chrome
 * from a ``ComponentCatalogEntry`` — header text and the action-name
 * input live as plain fields.
 *
 * Public surface mirrors the automation/script editors:
 *
 * - ``configuration``, ``board``, ``platform``, ``value``,
 *   ``location``, ``yaml``, ``addMode`` props.
 * - Events: ``automation-change``, ``yaml-draft`` / ``yaml-updated``
 *   (auto-apply + delete), ``section-select`` after delete,
 *   ``dirty-change``, ``section-mount`` / ``section-unmount``.
 *
 * Save/delete are optimistic + revert-on-failure per CLAUDE.md.
 * ``inFlightWrite`` signals to the parent's reconnect handler to
 * skip clobbering an in-flight write.
 */
import { consume } from "@lit/context";
import { mdiDelete, mdiOpenInNew, mdiWebhook } from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { ESPHomeAPI } from "../../../api/index.js";
import type {
  AutomationLocation,
  AutomationTree,
  AvailableAutomations,
} from "../../../api/types/automations.js";
import type { BoardCatalogEntry } from "../../../api/types/boards.js";
import { ESPHOME_DOCS_BASE } from "../../../common/docs.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { apiContext, localizeContext } from "../../../context/index.js";
import { inputStyles } from "../../../styles/inputs.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { getErrorMessage } from "../../../util/error-message.js";
import { normalizeEspHomeId } from "../../../util/esphome-id.js";
import { renderMarkdown } from "../../../util/markdown.js";
import { registerMdiIcons } from "../../../util/register-icons.js";
import { AutoApplyController } from "./auto-apply-controller.js";
import "./automation-action-list.js";
import { automationEditorStyles } from "./automation-editor.styles.js";
import "./callable-params-editor.js";
import { CatalogLoadController } from "./catalog-load-controller.js";
import { ParseErrorController } from "./parse-error-controller.js";
import { emptyAutomationTree } from "./serialise.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";

registerMdiIcons({
  delete: mdiDelete,
  "open-in-new": mdiOpenInNew,
  webhook: mdiWebhook,
});

/** ESPHome's docs page for the api component (which hosts
 *  ``api.actions:``). Linked from the header so the user lands on
 *  the right docs page from a single click. */
const API_DOCS_URL = `${ESPHOME_DOCS_BASE}/components/api.html`;

/** ``AutomationLocation`` variant for ``api.actions:`` entries —
 *  pulled out as a local alias because the api-action editor only
 *  ever holds this kind. */
type ApiActionLocation = Extract<AutomationLocation, { kind: "api_action" }>;

@customElement("esphome-api-action-editor")
export class ESPHomeApiActionEditor extends LitElement {
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
  location: ApiActionLocation | null = null;

  /** True when mounted from the "+ Add API action" dialog. Add-mode
   *  lets the user type the action name; edit-mode locks it. */
  @property({ type: Boolean, attribute: "add-mode" })
  addMode = false;

  @property() yaml = "";

  /** Scoped catalog response — drives the action / condition / script
   *  / device pickers inside the action list. */
  @state() private _available: AvailableAutomations | null = null;

  @state() private _loading = true;
  @state() private _error = "";
  /** Renders read-only + blocks auto-apply for a parse-errored
   *  action so its empty tree can't overwrite the real YAML. */
  private readonly _parseError = new ParseErrorController(this);

  /** Shared auto-apply / delete / dirty-tracking engine — same
   *  instance shape as the automation and script editors so the
   *  page-level save guard can treat all three uniformly. */
  private readonly _engine = new AutoApplyController(this, {
    getApi: () => this._api,
    getLocalize: () => this._localize,
    isReadOnly: () => this._parseError.active,
    // Can't upsert an api action with no name.
    canApply: (location) => location.kind === "api_action" && !!location.action_name,
    setError: (message) => {
      this._error = message;
    },
  });

  /** Catalog loader; owns the concurrency guard so overlapping loads
   *  (connectedCallback + updated both reaching ``_loadAvailable``)
   *  can't clobber ``_available`` or double-fire the toast. */
  private readonly _catalogLoad = new CatalogLoadController(this);

  public get dirty(): boolean {
    return this._engine.dirty;
  }

  public get inFlightWrite(): boolean {
    return this._engine.inFlightWrite;
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
    // Navigator-driven location swap (user clicked a different
    // api_action in the navigator) — invalidate the stale value so
    // the hydrate path below re-fetches.
    if (changed.has("location") && !this.addMode) {
      const prev = changed.get("location") as ApiActionLocation | null | undefined;
      if (prev && this.location && prev.action_name !== this.location.action_name) {
        this.value = null;
      }
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

  /**
   * Force a pending debounced auto-apply to flush immediately.
   * The device page calls this on the active section before its
   * global save so the YAML buffer is fully caught up.
   */
  public flushPending(): Promise<void> {
    return this._engine.flushPending();
  }

  protected render() {
    if (this._loading) {
      return html`<div class="ae-empty">
        <wa-spinner></wa-spinner>
        ${this._localize("device.loading_automation_catalog")}
      </div>`;
    }
    if (this._parseError.active) {
      return this._parseError.renderPanel(this._localize);
    }
    const automation = this.value ?? emptyAutomationTree();
    const devices = this._available?.devices ?? [];
    const scripts = this._available?.scripts ?? [];
    const actions = this._available?.actions ?? [];
    const conditions = this._available?.conditions ?? [];
    const disabled = this._engine.deleting;
    return html`
      ${this._renderHeader()} ${this._renderActionNameField(disabled)}
      <esphome-callable-params-editor
        .value=${(automation.trigger_params.variables ?? {}) as Record<string, string>}
        ?disabled=${disabled}
        .fieldLabel=${this._localize("device.api_action_variables")}
        .description=${this._localize("device.api_action_variables_description")}
        .addLabel=${this._localize("device.api_action_add_variable")}
        .namePlaceholder=${this._localize("device.api_action_variable_name_placeholder")}
        @value-change=${this._onVariablesChange}
      ></esphome-callable-params-editor>
      <div class="field">
        <label class="field-label"> ${this._localize("device.automation_action")} </label>
        <p class="field-description">
          ${renderMarkdown(this._localize("device.api_action_actions_description"))}
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
      ${this._error ? html`<p class="ae-error" role="alert">${this._error}</p>` : nothing}
      ${
        this.location && this.value && !this.addMode
          ? html`<div class="ae-actions">
              <button
                type="button"
                class="ae-danger"
                ?disabled=${disabled}
                @click=${this._onDelete}
              >
                <wa-icon library="mdi" name="delete"></wa-icon>
                ${this._localize("dashboard.delete")}
              </button>
            </div>`
          : nothing
      }
    `;
  }

  private _renderHeader() {
    return html`<div class="ae-header">
      <div class="ae-header-text">
        <h2 class="ae-header-title">
          ${this._localize("device.api_action_header_title_static")}
        </h2>
        <a class="ae-header-docs" href=${API_DOCS_URL} target="_blank" rel="noreferrer">
          ${this._localize("device.docs")}
          <wa-icon library="mdi" name="open-in-new"></wa-icon>
        </a>
        <p class="ae-header-desc">
          ${renderMarkdown(this._localize("device.api_action_header_description"))}
        </p>
      </div>
      <div class="ae-header-icon">
        <wa-icon library="mdi" name="webhook"></wa-icon>
      </div>
    </div>`;
  }

  /** Action-name input. Locked in edit mode so the YAML splice
   *  destination stays pinned (renaming would move the entry to a
   *  different slot and require a delete + insert; we don't support
   *  that inline). ``readonly`` rather than ``disabled`` for the
   *  lock so the value stays focusable / selectable for copy and
   *  screen readers; ``disabled`` is reserved for the during-delete
   *  state where the whole editor is inert. */
  private _renderActionNameField(disabled: boolean) {
    const name = this.location?.action_name ?? "";
    return html`<div class="field">
      <label class="field-label" for="api-action-name">
        ${this._localize("device.api_action_id_label")}
      </label>
      <p class="field-description">
        ${renderMarkdown(this._localize("device.api_action_id_description"))}
      </p>
      <input
        id="api-action-name"
        type="text"
        .value=${name}
        ?disabled=${disabled}
        ?readonly=${!this.addMode}
        @input=${(e: Event) =>
          this._onActionNameChange((e.target as HTMLInputElement).value)}
      />
    </div>`;
  }

  private async _load() {
    if (!this._api) return;
    this._loading = true;
    this._error = "";
    try {
      if (this.configuration) await this._loadAvailable();
    } catch (err) {
      this._error = getErrorMessage(err);
    } finally {
      this._loading = false;
    }
  }

  private async _loadAvailable() {
    // Hydrates config_entries (the slim catalog omits them); without
    // it every action renders fieldless since the node bails on an
    // empty config_entries list.
    this._error = "";
    const { available, error } = await this._catalogLoad.load(
      this._api,
      this.configuration,
      this._localize
    );
    if (error !== undefined) this._error = error;
    if (available) this._available = available;
  }

  private async _hydrateFromBackend() {
    if (!this._api || !this.configuration || !this.location) return;
    try {
      // Pass ``this.yaml`` so the parser sees the current draft
      // buffer — without it the post-add hydrate would read on-disk
      // and miss the just-inserted entry.
      const parsed = await this._api.parseDeviceAutomations(
        this.configuration,
        this.yaml
      );
      const m = this._parseError.resolve(parsed, this.location, "api_action");
      if (m) {
        this.location = m.location;
        this.value = m.tree;
      }
    } catch (err) {
      this._error =
        err instanceof Error
          ? err.message
          : this._localize("device.automation_parse_error");
    }
  }

  /**
   * Re-hydrate from the live YAML. Called by the parent
   * (``device-board-info``) when the YAML pane changes the document
   * out from under us — mirrors device-section-config.reload() and
   * automation/script reload() so editing YAML in the pane updates
   * the visual editor.
   */
  public reload(): void {
    if (this.addMode || !this.location) return;
    if (this._engine.shouldSkipReload()) return;
    void this._hydrateFromBackend();
  }

  private _onActionNameChange(name: string) {
    // Normalize so the field reshapes invalid characters
    // (``"my action"`` → ``"my_action"``) as the user types and the
    // YAML key the upsert produces is always valid.
    const normalized = normalizeEspHomeId(name);
    if (!normalized) return;
    this.location = { kind: "api_action", action_name: normalized };
    this._engine.scheduleAutoApply();
  }

  private _onVariablesChange = (e: CustomEvent<{ value: Record<string, string> }>) => {
    e.stopPropagation();
    const automation = this.value ?? emptyAutomationTree();
    this._engine.withValue({
      trigger_params: {
        ...automation.trigger_params,
        variables: e.detail.value,
      },
    });
  };

  private _onActionsChange = (e: CustomEvent<{ actions: AutomationTree["actions"] }>) => {
    e.stopPropagation();
    this._engine.withValue({ actions: e.detail.actions });
  };

  private _onDelete = () => {
    void this._engine.delete();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-api-action-editor": ESPHomeApiActionEditor;
  }
}
