/**
 * Shared base for the three automation-section editors (automation,
 * script, api-action): the common public props, context consumers,
 * the parse-error / catalog-load / auto-apply controllers, and the
 * error + confirm-gated delete footer. Subclasses own their body
 * render and lifecycle (hydrate, catalog lists, headers).
 */
import { consume } from "@lit/context";
import { html, LitElement, nothing } from "lit";
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

  /** True when mounted from an add entry point; edit-mode locks the
   *  identity the wizard collected. */
  @property({ type: Boolean, attribute: "add-mode" })
  addMode = false;

  @property() yaml = "";

  /** Indexed key path at the YAML cursor; resolved against the
   *  hydrated tree to scroll/highlight the matching node or field. */
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
  protected _canApply?: (location: AutomationLocation) => boolean;

  /** Shared auto-apply / delete / dirty-tracking engine — one
   *  instance shape so the page-level save guard treats all three
   *  editors uniformly. */
  protected readonly _engine = new AutoApplyController(this, {
    getApi: () => this._api,
    getLocalize: () => this._localize,
    isReadOnly: () => this._parseError.active,
    canApply: (location) => this._canApply?.(location) ?? true,
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

  static styles = [espHomeStyles, inputStyles, automationEditorStyles];

  /** Inline error line + the confirm-gated delete footer. */
  protected renderFooter(deleteOpts: { label: string; message: string }) {
    return html`${
      this._error ? html`<p class="ae-error" role="alert">${this._error}</p>` : nothing
    }${
      this.location && this.value && !this.addMode
        ? renderDeleteRow({
            ...deleteOpts,
            disabled: this._engine.deleting,
            onConfirm: this._onDelete,
          })
        : nothing
    }`;
  }

  protected _onDelete = () => {
    void this._engine.delete();
  };
}
