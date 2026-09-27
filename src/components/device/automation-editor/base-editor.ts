/**
 * Shared base for the three automation-section editors (automation,
 * script, api-action): the common public props, context consumers,
 * the parse-error / catalog-load / auto-apply controllers, and the
 * error + confirm-gated delete footer. Subclasses own their body
 * render and lifecycle (hydrate, catalog lists, headers).
 */
import { consume, provide } from "@lit/context";
import { type CSSResultGroup, html, LitElement, nothing } from "lit";
import { property, state } from "lit/decorators.js";

import type { ESPHomeAPI } from "../../../api/index.js";
import type {
  AutomationLocation,
  AutomationTree,
  AvailableAutomations,
  ParsedAutomation,
} from "../../../api/types/automations.js";
import type { BoardCatalogEntry } from "../../../api/types/boards.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import {
  apiContext,
  localizeContext,
  valuesReadContext,
} from "../../../context/index.js";
import { inputStyles } from "../../../styles/inputs.js";
import { espHomeStyles, heldStyles } from "../../../styles/shared.js";
import { formatApiError } from "../../../util/format-api-error.js";
import { setHeld } from "../../../util/held.js";
import { KeyedPromiseCache } from "../../../util/keyed-promise-cache.js";
import type { SectionEditor } from "../section-editor.js";
import { AutoApplyController } from "./auto-apply-controller.js";
import { automationEditorStyles } from "./automation-editor.styles.js";
import { createFocusResolver, type YamlPathSegment } from "./automation-focus.js";
import { CatalogLoadController } from "./catalog-load-controller.js";
import { ParseErrorController } from "./parse-error-controller.js";
import { renderDeleteRow } from "./render-delete-row.js";
import { sectionKeyFromLocation } from "./serialise.js";

import "@home-assistant/webawesome/dist/components/spinner/spinner.js";

export abstract class BaseAutomationEditor<L extends AutomationLocation>
  extends LitElement
  implements SectionEditor
{
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

  /** A relocation is re-reading the tree; the previous one stays on
   *  screen read-only until the parse lands. */
  @state() protected _hydrating = false;
  private _hydrateId = 0;

  /** One ``automations/parse`` per buffer while it is in flight, so a burst
   *  of relocations and reloads shares the round trip. */
  private readonly _parses = new KeyedPromiseCache<ParsedAutomation[]>({
    evictOnSettle: true,
  });

  protected _resolveFocus = createFocusResolver();

  /** Counts the automations the parent has pointed this editor at. The
   *  editor is reused, so each one keys its body on this to start the
   *  next automation with fresh rows and forms. It advances when the new
   *  tree lands. */
  protected _target = 0;
  private _retargeted = false;

  /** Provided as ``valuesReadContext``. */
  @provide({ context: valuesReadContext }) private _valuesRead = 0;

  /** The YAML was edited outside the editor and the tree shown is from
   *  before that edit; the read follows up to a second later. Written from
   *  it, the section would undo the edit (#1920), so the editor is held
   *  until that read has settled. */
  @state() private _stale = false;

  /** Inert and read-only: the tree on screen is about to be replaced. */
  private get _held(): boolean {
    return this._hydrating || this._stale;
  }

  /** "Show advanced settings" of the editor's own form; collapsed again
   *  for each automation the editor is pointed at. */
  @state() protected _showAdvanced = false;

  /** Focus target for the current caret; none while the tree of another
   *  automation is shown. While the tree is from before an outside edit it
   *  stays the target it was: the caret would land on the row that had its
   *  place before the edit. */
  protected _currentFocus() {
    if (this._stale) return this._focus;
    this._focus = this._resolveFocus(
      this._hydrating ? null : this.value,
      this.location,
      this.focusYamlPath
    );
    return this._focus;
  }

  private _focus: ReturnType<typeof this._resolveFocus> = null;

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
    isReadOnly: () => this._parseError.active || this._held,
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

  public get lastFlushFailed(): boolean {
    return this._engine.lastRoundFailed;
  }

  static styles: CSSResultGroup = [
    espHomeStyles,
    heldStyles,
    inputStyles,
    automationEditorStyles,
  ];

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

  /** Implementers own the ``_loading = false`` transition (directly
   *  or via ``CallableAutomationEditor._load``), or the editor
   *  sticks on the spinner forever. */
  protected abstract _loadAvailable(): Promise<void>;

  protected async _hydrateFromBackend() {
    if (!this._api || !this.configuration || !this.location) {
      // Nothing can read the tree: not with the one from before an edit.
      if (this._stale) this.value = null;
      this._dropStaleTree();
      this._stale = false;
      return;
    }
    const id = ++this._hydrateId;
    // Held while there is no tree yet: an edit would write an empty one.
    if (this.value === null && !this.addMode) this._hydrating = true;
    const { configuration, yaml } = this;
    // A newer parse replaced this one, or the YAML was edited since and this
    // is a reload: the tree on screen waits for the reload of that edit, or
    // is the one of the YAML the editor wrote when the edit was taken back.
    const outdated = () =>
      id !== this._hydrateId || (yaml !== this.yaml && !this._hydrating);
    // Read before the wait: a write the editor makes meanwhile must not
    // turn a read that follows an outside edit into one of its own.
    const counts = this._stale || !this._engine.shouldSkipReload();
    try {
      // Pass ``this.yaml`` so the parser sees the user's current
      // draft buffer — without it the post-add hydrate would read
      // the on-disk YAML, miss the just-inserted section, and
      // leave the form empty even though the YAML pane shows the
      // user's input.
      const parsed = await this._parses.fetch(`${configuration}\0${yaml}`, () =>
        this._api.parseDeviceAutomations(configuration, yaml)
      );
      if (outdated()) return;
      // A successful parse clears any prior parse error, so the banner
      // doesn't stick after the user fixes invalid YAML in the pane.
      this._error = "";
      // Re-pin location to the parser's canonical form; the
      // controller withholds a read-only section's empty tree.
      const m = this._parseError.resolve(parsed, this.location);
      if (m) {
        this.location = m.location;
        if (this._retargeted) {
          this._target++;
          this._showAdvanced = false;
        }
        this._retargeted = false;
        if (counts) this._valuesRead++;
        this.value = m.tree;
        this._hydrating = false;
        // The re-read tree replaced the form state, failed edit
        // included — a still-latched flush failure would refuse a
        // leave over an edit that no longer exists.
        this._engine.notifyHydrated();
      } else {
        // The edit took the section out of the YAML: written, the tree
        // from before would put it back.
        if (this._stale && !this._parseError.active) this.value = null;
        this._dropStaleTree();
      }
    } catch (err) {
      if (outdated()) return;
      this._dropStaleTree();
      this._error = formatApiError(err, this._localize, "device.automation_parse_error");
      // The hold stays: the tree is still from before the edit. A YAML
      // broken mid edit fails here, and the next edit reads again.
      return;
    }
    // Held on for a YAML edited since: its own reload is still to come.
    this._stale = yaml !== this.yaml;
  }

  connectedCallback() {
    super.connectedCallback();
    // Attached again after a detach that dropped its tree.
    if (this.hasUpdated && !this.addMode && this.value === null && !this._loading) {
      void this._hydrateFromBackend();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // A parse resolving after unmount must not write into the element,
    // and a re-attached one must not come back read-only or show the
    // previous section's tree under the new location.
    this._hydrateId++;
    // Nor with the tree from before an outside edit, which nothing would
    // read again.
    if (this._stale) this.value = null;
    this._stale = false;
    this._dropStaleTree();
    setHeld(this, false);
  }

  /** A relocation whose parse found no tree must not keep showing the
   *  previous section's. */
  private _dropStaleTree() {
    if (!this._hydrating) return;
    this.value = null;
    this._hydrating = false;
  }

  protected willUpdate(changed: Map<string, unknown>) {
    // Navigator-driven location swap: when the parent passes in a
    // different ``location`` (user clicked a sibling section), the
    // editor element is reused — its previous ``value`` is stale, so
    // the hydrate path in ``updated`` re-fetches.
    if (changed.has("location") && !this.addMode) {
      const prev = changed.get("location") as L | null | undefined;
      if (
        prev &&
        this.location &&
        sectionKeyFromLocation(prev) !== sectionKeyFromLocation(this.location)
      ) {
        this._hydrating = true;
        this._retargeted = true;
      }
    }
    // As ``reload()``: an edit of the form on its way out keeps its tree.
    // An edit taken back leaves the YAML the editor wrote, which no reload
    // reads, so the hold ends here.
    if (changed.get("yaml") !== undefined && !this.addMode) {
      const outside = !this._engine.shouldSkipReload();
      // Once for a burst of edits: each count renders every form below.
      if (outside && !this._stale) this._valuesRead++;
      this._stale =
        outside && this.location !== null && this.value !== null && !this._engine.dirty;
    }
    setHeld(this, this._held);
  }

  protected updated(changed: Map<string, unknown>) {
    if (changed.has("configuration")) {
      void this._loadAvailable();
    }
    // Hydrate from the backend in edit-mode: mounted with a known
    // location but no value. Triggering on ``_loading`` covers the
    // common case where the location was already set at mount — the
    // first change fires while ``_loading=true``, so re-check after
    // catalogs finish loading rather than waiting for another
    // location mutation that may never come.
    if (
      !this.addMode &&
      (changed.has("location") ||
        changed.has("configuration") ||
        changed.has("_loading")) &&
      this.location &&
      (this.value === null || this._hydrating) &&
      !this._loading
    ) {
      void this._hydrateFromBackend();
    }
  }

  /**
   * Re-hydrate from the live YAML. Called by the parent
   * (``device-board-info``) when the YAML pane changes the document
   * out from under us — mirrors the device-section-config reload
   * pattern so editing YAML in the pane updates the visual editor.
   */
  public reload(): void {
    this._stale =
      !this.addMode && this.location !== null && !this._engine.shouldSkipReload();
    if (this._stale) void this._hydrateFromBackend();
  }

  protected _onAdvancedToggle = (e: CustomEvent<{ show: boolean }>) => {
    this._showAdvanced = e.detail.show;
  };

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
