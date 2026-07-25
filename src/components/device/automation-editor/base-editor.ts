/**
 * Shared base for the three automation-section editors (automation,
 * script, api-action): the common public props, context consumers,
 * the parse-error / catalog-load / auto-apply controllers, and the
 * error + confirm-gated delete footer. Subclasses own their body
 * render and lifecycle (hydrate, catalog lists, headers).
 */
import { consume } from "@lit/context";
import { type CSSResultGroup, html, LitElement, nothing } from "lit";
import { property, state } from "lit/decorators.js";

import type { ESPHomeAPI } from "../../../api/index.js";
import type {
  AutomationLocation,
  AutomationTree,
  AvailableAutomations,
} from "../../../api/types/automations.js";
import type { BoardCatalogEntry } from "../../../api/types/boards.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { apiContext, localizeContext } from "../../../context/index.js";
import { inputStyles } from "../../../styles/inputs.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { AutoApplyController } from "./auto-apply-controller.js";
import { automationEditorStyles } from "./automation-editor.styles.js";
import { createFocusResolver, type YamlPathSegment } from "./automation-focus.js";
import { CatalogLoadController } from "./catalog-load-controller.js";
import { ParseErrorController } from "./parse-error-controller.js";
import { renderDeleteRow } from "./render-delete-row.js";

import "@home-assistant/webawesome/dist/components/spinner/spinner.js";

export abstract class BaseAutomationEditor<
  L extends AutomationLocation,
> extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  protected _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  protected _api!: ESPHomeAPI;

  @property() configuration = "";

  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @property() platform = "";

  @property({ attribute: false })
  value: AutomationTree | null = null;

  @property({ attribute: false })
  location: L | null = null;

  /**
   * True when mounted from an add entry point (the add-automation /
   * add-script / add-api-action dialogs). Edit-mode locks the
   * section's identity — changing it would move the YAML splice to
   * a different range, which isn't supported inline. The add dialog
   * passes a seed ``location`` alongside this flag, which we'd
   * otherwise have to infer racily.
   */
  @property({ type: Boolean, attribute: "add-mode" })
  addMode = false;

  @property() yaml = "";

  /** Document-absolute indexed key path at the YAML cursor; resolved
   *  against the hydrated tree to scroll/highlight the matching node
   *  or field. Ignored when it doesn't land inside this section. */
  @property({ attribute: false })
  focusYamlPath?: YamlPathSegment[];

  /** Scoped catalog response — the backend filters to what the
   *  device's YAML can actually use. */
  @state() protected _available: AvailableAutomations | null = null;

  @state() protected _loading = true;
  @state() protected _error = "";

  protected _resolveFocus = createFocusResolver();

  /** Renders read-only + blocks auto-apply for a parse-errored
   *  section so its empty tree can't overwrite the real YAML. */
  protected readonly _parseError = new ParseErrorController(this);

  /** Owns the catalog-load concurrency guard so overlapping loads
   *  can't clobber ``_available`` or double-fire the toast. */
  protected readonly _catalogLoad = new CatalogLoadController(this);

  /** Per-editor upsert guard (a script can't upsert with an empty
   *  ``id``, an api action with an empty ``action_name``). */
  protected _canApply(_location: AutomationLocation): boolean {
    return true;
  }

  /** Shared auto-apply / delete / dirty-tracking engine — one
   *  instance shape so the page-level save guard treats all three
   *  editors uniformly. */
  protected readonly _engine = new AutoApplyController(this, {
    getApi: () => this._api,
    getLocalize: () => this._localize,
    isReadOnly: () => this._parseError.active,
    canApply: (location) => this._canApply(location),
    setError: (message) => {
      this._error = message;
    },
  });

  public get dirty(): boolean {
    return this._engine.dirty;
  }

  /** In-flight write guard — parents that re-fetch on reconnect
   *  consult this to skip clobbering an optimistic update. */
  public get inFlightWrite(): boolean {
    return this._engine.inFlightWrite;
  }

  /**
   * Force a pending debounced auto-apply to flush immediately.
   * The device page calls this on the active section before its
   * global save so the YAML buffer is fully caught up.
   */
  public flushPending(): Promise<void> {
    return this._engine.flushPending();
  }

  static styles: CSSResultGroup = [espHomeStyles, inputStyles, automationEditorStyles];

  /** Loading spinner / parse-error panel that preempts the body
   *  render, or ``null`` once the editor is ready to paint. */
  protected renderStateGate() {
    if (this._loading) {
      return html`<div class="ae-empty">
        <wa-spinner></wa-spinner>
        ${this._localize("device.loading_automation_catalog")}
      </div>`;
    }
    if (this._parseError.active) {
      return this._parseError.renderPanel(this._localize);
    }
    return null;
  }

  /** Inline error line + the confirm-gated delete footer. The
   *  message factory receives the non-null ``location`` so callers
   *  build it inside the narrowing. */
  protected renderFooter(deleteOpts: {
    label: string;
    message: (location: L) => string;
  }) {
    return html`${
      this._error ? html`<p class="ae-error" role="alert">${this._error}</p>` : nothing
    }${
      this.location && this.value && !this.addMode
        ? renderDeleteRow({
            label: deleteOpts.label,
            message: deleteOpts.message(this.location),
            disabled: this._engine.deleting,
            onConfirm: this._onDelete,
          })
        : nothing
    }`;
  }

  protected _onDelete = () => {
    void this._engine.delete();
  };

  protected _onActionsChange = (
    e: CustomEvent<{ actions: AutomationTree["actions"] }>
  ) => {
    e.stopPropagation();
    this._engine.withValue({ actions: e.detail.actions });
  };
}
