import { consume } from "@lit/context";
import { mdiArrowLeft, mdiChevronRight, mdiMenu } from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { cache } from "lit/directives/cache.js";
import { classMap } from "lit/directives/class-map.js";
import memoizeOne from "memoize-one";
import type { ESPHomeAPI } from "../api/index.js";
import type { YamlDiff } from "../api/types/automations.js";
import type { BoardCatalogEntry } from "../api/types/boards.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import type { FirmwareJob } from "../api/types/firmware-jobs.js";
import { ErrorCode } from "../api/types/protocol.js";
import type { LocalizeFunc } from "../common/localize.js";
import type { ESPHomeCommandDialog } from "../components/command-dialog.js";
import { applyRemoval } from "../components/device/apply-removal.js";
import { applyYamlDiff } from "../components/device/automation-editor/serialise.js";
import type { ESPHomeBoardReselectDialog } from "../components/device/board-reselect-dialog.js";
import type { NavSectionName } from "../components/device/device-board-info.js";
import type { DeviceLayoutMode } from "../components/device/device-editor.js";
// `NavSectionName` is consumed by the section-show event handler; the
// page itself doesn't pass it down anymore now that the step CTAs
// always render.
import { DeviceInstallController } from "../components/device/device-install-controller.js";
import type {
  SectionEditor,
  YamlDraftDetail,
  YamlUpdatedDetail,
} from "../components/device/section-editor.js";
import type { ESPHomeFirmwareInstallDialog } from "../components/firmware-install-dialog.js";
import { tourAnchor } from "../components/guided-tour/tour-anchor.js";
import { TourLayoutController } from "../components/guided-tour/tour-layout-controller.js";
import type { ESPHomeLogsDialog } from "../components/logs-dialog.js";
import type { ESPHomeUnsavedChangesDialog } from "../components/unsaved-changes-dialog.js";
import type { HighlightRange } from "../components/yaml-editor.js";
import type { ESPHomeYamlValidationDialog } from "../components/yaml-validation-dialog.js";
import {
  activeJobsContext,
  apiConnectedContext,
  apiContext,
  devicesContext,
  devicesLoadedContext,
  localizeContext,
} from "../context/index.js";
import { loadMessageStyles } from "../styles/load-message.js";
import { espHomeStyles } from "../styles/shared.js";
import {
  backendErrorCounts,
  backendErrorsForInstance,
  type BackendFieldError,
  formRelativePath,
  instanceKey,
  resolveBackendErrors,
} from "../util/backend-field-errors.js";
import { fetchBoard } from "../util/board-body-cache.js";
import { applyBoardChange, openBoardReselect } from "../util/board-change.js";
import { ConfigLoadController } from "../util/config-load-controller.js";
import { showPendingChanges, showUpdateAvailable } from "../util/device-sync.js";
import { deviceLayoutToPref, prefToDeviceLayout } from "../util/editor-layout.js";
import { followActiveJob } from "../util/firmware-job-display.js";
import { consumeJustCreated } from "../util/just-created.js";
import { goBackOrHome, navigate, PopLeaveGuardController } from "../util/navigation.js";
import { notifyError, notifyInfo, notifySuccess } from "../util/notify.js";
import { postInstallShowLogsHandler } from "../util/post-install-logs.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { renderAsyncState } from "../util/render-async-state.js";
import { isTypingTarget } from "../util/typing-target.js";
import { UnsavedGuard } from "../util/unsaved-guard.js";
import {
  resolveSectionForUrlLine,
  resolveUrlLineFocus,
} from "../util/url-line-resolver.js";
import { buildWebUiUrl } from "../util/web-ui-url.js";
import { boardDisagreesWithYaml, readPlatformBoard } from "../util/yaml-board.js";
import { loadCatalog } from "../util/yaml-completion-catalog.js";
import { knownTopLevelKeys } from "../util/yaml-completion-items.js";
import {
  getLastValidatedResult,
  type YamlDiagnosticsDetail,
} from "../util/yaml-lint-backend.js";
import {
  findFieldLine,
  parseYamlTopLevelSections,
  resolveCurrentSectionLine,
  sectionForCursor,
  sectionKeyOf,
  type YamlSection,
} from "../util/yaml-sections.js";
import {
  basename,
  isOpenConfigFile,
  summarizeValidation,
} from "../util/yaml-validation-summary.js";
import { devicePageStyles } from "./device-styles.js";
import {
  buildDeviceUrl,
  readUrlLine,
  readUrlParam,
  readUrlSections,
} from "./device-url-state.js";

import "@home-assistant/webawesome/dist/components/button/button.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "../components/command-dialog.js";
import "../components/device/board-reselect-dialog.js";
import "../components/device/device-editor.js";
import "../components/device/device-navigator.js";
import "../components/firmware-install-dialog.js";
import "../components/install-method-dialog.js";
import "../components/logs-dialog.js";
import "../components/unsaved-changes-dialog.js";
import "../components/yaml-validation-dialog.js";

registerMdiIcons({
  "arrow-left": mdiArrowLeft,
  "chevron-right": mdiChevronRight,
  menu: mdiMenu,
});

@customElement("esphome-page-device")
export class ESPHomePageDevice extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  /** ``true`` once the initial subscribe-events payload landed.
   *  ``_platformReady`` uses this to tell "context still loading"
   *  apart from "context delivered, our id isn't here" — a length
   *  check would strand the gate on a zero-device dashboard. */
  @consume({ context: devicesLoadedContext, subscribe: true })
  @state()
  private _devicesLoaded = false;

  /** WS liveness; the false→true edge re-runs a load that gave up. */
  @consume({ context: apiConnectedContext, subscribe: true })
  @state()
  private _apiConnected = false;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @consume({ context: activeJobsContext, subscribe: true })
  @state()
  private _activeJobs: Map<string, FirmwareJob> = new Map();

  @property()
  id = "";

  /** True for the brief window between the wizard finishing and the
   *  user dismissing / leaving — drives the "Congratulations!" banner
   *  in the content pane. Sourced from a one-shot sessionStorage flag
   *  set by the wizard, consumed once on first matching id load. */
  @state()
  private _justCreated = false;

  @state()
  private _layout: DeviceLayoutMode = "both";

  /** Side-effect controller; the field only keeps the registration alive. */
  protected readonly _tourLayout = new TourLayoutController(
    this,
    () => this._layout,
    (layout: DeviceLayoutMode) => {
      this._layout = layout;
    }
  );

  @state()
  private _openSections = new Set<number>(this._readUrlSections());

  private get _device(): ConfiguredDevice | null {
    return this._devices.find((d) => d.configuration === this.id) ?? null;
  }

  /** Catalog entry for the current device's board. Loaded lazily when
   *  the device's `board_id` resolves — see `_loadBoard`. */
  @state()
  private _board: BoardCatalogEntry | null = null;

  /** ``true`` once this device's platform is known (manifest
   *  fetched, fetch failed, or no ``board_id``). The navigator
   *  gates on this to avoid the typical mount-time double-fetch
   *  (yaml-edge with ``platform=""``, then platform-edge with the
   *  real value); the no-board branch below has a documented
   *  narrow window where it can still flip early. Resets on
   *  device-id change. */
  @state()
  private _platformReady = false;

  /** Last `board_id` we kicked off a fetch for. Used to dedupe so a
   *  re-render doesn't refetch the same board, and to detect board
   *  changes (rename / wizard re-run) and refetch when needed. */
  private _loadedBoardId: string | null = null;

  @state()
  private _highlightRange: HighlightRange | null = null;

  @state()
  private _scrollToHighlight = false;

  /** Lifecycle of an error-jump highlight (the validation prompt's
   *  "Go to error"): "active" until the user edits, "edited" after,
   *  which arms the next lint pass to clear the highlight. Navigation
   *  and field-focus highlights stay "none". */
  private _errorHighlight: "none" | "active" | "edited" = "none";

  @state()
  private _selectedSection: string | null = this._readUrlParam("section", null);

  @state()
  private _selectedFromLine?: number;

  /** One-shot ``?line=`` deep-link intent, consumed (cleared) by
   *  ``_maybeResolveLineFromUrl`` once the YAML is loaded. Kept apart
   *  from ``_selectedFromLine`` — that field is durable section-instance
   *  state the URL round-trips, so parking the intent there would
   *  re-derive focus on every later load (board swap). */
  private _pendingUrlLine?: number = this._readUrlLine();

  /** Instance-relative field path the YAML cursor is on, for the form to
   *  scroll into view; empty on a section header / non-field line. */
  @state()
  private _focusFieldPath?: string[];

  /** Document-absolute indexed key path at the cursor — the automation
   *  editor resolves it against its tree to deep-target a nested node. */
  @state()
  private _focusYamlPath?: (string | number)[];

  /** Backend validation errors resolved onto section instances, refreshed
   *  on every lint pass. Feeds the navigator badges and the selected
   *  section's inline form errors. */
  @state()
  private _backendErrors: BackendFieldError[] = [];

  /** instanceKey of the half-typed unknown section whose selection switch
   *  and navigator error chip are held while the user is still typing its
   *  key; null when nothing is held. */
  @state()
  private _heldUnknownInstance: string | null = null;

  /** Valid top-level keys (core + automation + catalog domains/ids); null
   *  until the catalog resolves — treated as "everything is known" so a
   *  failed catalog fetch degrades to no holds, never to holding all
   *  typed section switches. */
  private _knownTopLevelKeys: Set<string> | null = null;
  private _catalogKicked = false;

  // Memoised so idle re-renders keep the prop identities stable — the
  // section editor keys its per-edit error suppression on the prop
  // changing, and a fresh object every render would wipe it immediately.
  private _instanceBackendErrors = memoizeOne(backendErrorsForInstance);
  private _baseErrorCounts = memoizeOne(backendErrorCounts);

  /** Navigator error counts minus the held instance's chip. The held key
   *  changes on every keystroke of a half-typed section name, so the base
   *  map is memoized on the errors alone and returned as-is (stable
   *  identity, no navigator churn) unless it actually contains the held
   *  entry. */
  private _navErrorCounts(
    errors: readonly BackendFieldError[],
    held: string | null
  ): Map<string, number> {
    const base = this._baseErrorCounts(errors);
    if (held === null || !base.has(held)) return base;
    const counts = new Map(base);
    counts.delete(held);
    return counts;
  }

  /** Form-relative path of the last focused field, and whether its YAML
   *  line wasn't found yet (a just-added value whose debounced write is
   *  pending) — drives a one-shot re-resolve on the next YAML update.
   *  ``_pendingFieldSection`` pins the section it was queued for so a
   *  navigation away cancels the retry instead of resolving in the wrong one. */
  private _focusedFieldPath?: string[];
  private _pendingFieldLine = false;
  private _pendingFieldSection?: { section: string | null; fromLine?: number };

  /** Per-page navigation stack — each entry is a section the user
   *  visited *before* the current one, ordered oldest-first. The
   *  back button pops the top entry; an empty stack means "back goes
   *  to the board-info / next-steps view". Cleared whenever the
   *  current selection drops back to ``null`` so a later trip into a
   *  section starts a fresh trail. */
  @state()
  private _sectionHistory: Array<{ key: string; fromLine?: number }> = [];

  @state()
  private _drawerOpen = false;

  @state()
  private _navCollapsed = false;

  @state()
  private _isMobile = window.matchMedia("(max-width: 900px)").matches;

  private _mql = window.matchMedia("(max-width: 900px)");

  private _onMqlChange = (e: MediaQueryListEvent) => {
    this._isMobile = e.matches;
  };

  /**
   * Live device YAML, fed down through `device-editor` →
   * `device-board-info` to the section editor and the YAML pane.
   *
   * The section editor's scan memos
   * (`util/config-entry-yaml-scan.ts`) cache per-keystroke
   * pin / id-reference lookups by content (`a.yaml === b.yaml`,
   * value equality on primitive strings). Reassigning to the
   * same string instance hits the engine's pointer-equality
   * fast path; reconstructing a fresh string with identical
   * content still hits but pays a byte-compare on the first
   * call after the rebuild. A content change always misses
   * and re-scans.
   *
   * Patterns that produce a fresh string per render (and so
   * cost the byte-compare without breaking correctness):
   * template literals (``` `${value}` ```), `String(value)`,
   * `value.toString()`, `JSON.stringify(JSON.parse(value))`.
   * The current code path doesn't do any of these — `_yaml`
   * is only reassigned on user yaml-change events, save
   * events, or initial fetch — but a future refactor that
   * introduces them would silently demote the fast path.
   * Avoid when you can.
   */
  @state()
  private _yaml = "";

  /** Initial-fetch gate for the current id: the editor and navigator
   *  render only once "ready", so a slow ``getConfig`` shows a spinner
   *  instead of an empty editor. A transport failure offers a retry;
   *  a NOT_FOUND config (deleted, renamed, stale bookmark) is terminal,
   *  so it routes back to the dashboard instead. */
  protected readonly _load = new ConfigLoadController(this, {
    api: () => this._api,
    connected: () => this._apiConnected,
    configuration: () => this.id,
    // The user is staring at a spinner, so the initial fetch gets a
    // longer leash than the 10s command default: a big YAML over a
    // degraded link is slow, not broken.
    attempts: 4,
    timeoutMs: 30_000,
    commit: (yaml) => {
      this._yaml = yaml;
      this._savedYaml = yaml;
    },
    // Outside the failure path: a resolver throw must not repaint a
    // loaded config as a load failure.
    onReady: () => this._maybeResolveLineFromUrl(),
    onApiError: (err) => (err.errorCode === ErrorCode.NOT_FOUND ? "missing" : undefined),
  });

  @state()
  private _savedYaml = "";

  @state()
  private _saving = false;

  @query("esphome-unsaved-changes-dialog")
  private _unsavedDialog!: ESPHomeUnsavedChangesDialog;

  /** Live ref to the mounted section editor (component editor or
   *  one of the automation family), typed as the ``SectionEditor``
   *  contract the page consumes (``dirty`` / ``flushPending``).
   *  Captured via ``section-mount`` / ``section-unmount`` events
   *  the editors fire on their own lifecycle hooks; ``@query``
   *  doesn't reach across the three shadow roots between this
   *  page and the section editor. */
  private _activeSection: SectionEditor | null = null;

  @state()
  private _sectionDirty = false;

  @query("esphome-command-dialog")
  private _commandDialog!: ESPHomeCommandDialog;

  @query("esphome-firmware-install-dialog")
  private _firmwareDialog!: ESPHomeFirmwareInstallDialog;

  @query("esphome-logs-dialog")
  private _logsDialog!: ESPHomeLogsDialog;

  @query("esphome-yaml-validation-dialog")
  private _yamlValidationDialog!: ESPHomeYamlValidationDialog;

  @query("esphome-board-reselect-dialog")
  private _boardReselectDialog!: ESPHomeBoardReselectDialog;

  /** Holds the post-save board prompt while an install-triggered save
   *  runs, so it can't stack under the install-method dialog. */
  private _suppressBoardPrompt = false;

  /** Disagreement key the prompt already fired for; blocks a re-prompt
   *  on every save of the same dismissed state. */
  private _boardPromptShownFor: string | null = null;

  /** First-error / count snapshot driving the save-time validation
   *  prompt. Reset before opening the dialog and read by it via
   *  property bindings. */
  @state()
  private _validationErrorCount = 0;

  @state()
  private _validationFirstLine = 0;

  @state()
  private _validationFirstCol = 0;

  @state()
  private _validationFirstMessage = "";

  @state()
  private _validationFirstFile = "";

  private _onPostInstallShowLogs = postInstallShowLogsHandler(
    () => this._logsDialog,
    () => this._localize
  );

  private _installCtrl = this._createInstallController();

  private _createInstallController(): DeviceInstallController {
    // The object literal's getter below rebinds `this`.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const page = this;
    return new DeviceInstallController({
      addController: (c) => page.addController(c),
      removeController: (c) => page.removeController(c),
      requestUpdate: () => page.requestUpdate(),
      get updateComplete() {
        return page.updateComplete;
      },
      get device() {
        return page._device;
      },
      get commandDialog() {
        return page._commandDialog ?? null;
      },
      get firmwareDialog() {
        return page._firmwareDialog ?? null;
      },
      get logsDialog() {
        return page._logsDialog ?? null;
      },
      get api() {
        return page._api;
      },
      get localize() {
        return page._localize;
      },
      openActiveJobProgress: () => page._showActiveJobProgress(),
    });
  }

  /** Pending unsaved-changes guard. Both the page-leave check
   *  and the section-switch check pipe through this one helper:
   *  the dialog event handlers call into whichever one is
   *  currently set, the unset case is a no-op. Owning the
   *  bookkeeping in a separate class keeps the page lean and
   *  lets the logic be unit-tested in node without happy-dom. */
  private _unsavedGuard = new UnsavedGuard();

  protected readonly _leaveGuard = new PopLeaveGuardController(this, {
    confirmLeave: () => this._confirmLeave(),
    // Fails conservative via ``_sectionDirty`` (round pending) plus
    // ``lastFlushFailed`` (round settled as failed), same as beforeunload
    // (#1503); the flush kick rides here so it runs only for a real
    // leave, after the controller's suppression checks.
    isDirty: () => {
      this._kickSectionFlush();
      return this._isDirty || (this._activeSection?.lastFlushFailed ?? false);
    },
    url: () => `/device/${this.id}`,
  });

  private get _isYamlDirty(): boolean {
    return this._yaml !== this._savedYaml;
  }

  /** Combined "anything unsaved on this page" check.
   *
   *  The form auto-syncs into ``_yaml`` on a 200ms debounce
   *  (``device-section-config._flushDraft``), so once the debounce
   *  has fired ``_isYamlDirty`` already reflects the form edits.
   *  ``_sectionDirty`` covers the brief window between a keystroke
   *  and that flush — without it, hitting back / closing the tab
   *  inside that window would silently lose the last keystroke
   *  even though the user explicitly typed it.
   *
   *  The leave-page / save / popstate paths call
   *  ``_activeSection?.flushPending()`` before they read this
   *  getter. The component editor's flush promotes pending form
   *  edits into ``_yaml`` synchronously; the automation editors'
   *  flush is a backend round-trip that the save and leave paths
   *  await. A settled-as-failed round clears ``_sectionDirty``
   *  without landing a draft, so every leave path additionally
   *  reads the editor's ``lastFlushFailed`` — including the
   *  synchronous ones (beforeunload, popstate), where
   *  ``_sectionDirty`` covers a round still pending and
   *  ``lastFlushFailed`` covers one already settled as failed. */
  private get _isDirty(): boolean {
    return this._isYamlDirty || this._sectionDirty;
  }

  private _onUnsavedDiscard = () => this._unsavedGuard.onDiscard();
  private _onUnsavedSave = () => this._unsavedGuard.onSave();
  private _onUnsavedCancel = () => this._unsavedGuard.onCancel();

  private _confirmLeave = async (): Promise<boolean> => {
    // Promote any pending form keystrokes into ``_yaml`` before the
    // dialog so the user is shown the canonical "do you want to
    // save?" question. Awaited (mirroring ``_saveYaml``) so the
    // automation editors' backend upsert settles too — a kicked
    // flush would show the dialog against ``_sectionDirty``
    // (transient) rather than the YAML diff ``Save`` will commit.
    // A failed round clears ``_sectionDirty`` without landing a
    // draft, so the post-flush read alone would fail open; the
    // editor reports it through ``lastFlushFailed`` — the real
    // signal, so a flush that settles as a no-op (the user typed
    // and undid a keystroke) still leaves silently.
    let flushThrew = false;
    // The awaited flush is the same slow phase ``_saveYaml`` covers
    // with the Save spinner; borrow the flag so Back doesn't read as
    // dead for the length of the upsert. Own it only if free — a
    // save already in flight keeps its own lifecycle, and while the
    // validation prompt waits (``_saving`` false, resolver armed) a
    // "Save anyway" started mid-flush must not have its lock and
    // spinner cleared by our finally.
    const ownBusy = !this._saving && this._pendingValidationResolve === null;
    if (ownBusy) this._saving = true;
    try {
      await this._activeSection?.flushPending();
    } catch (err) {
      // The editors self-catch their upsert failures, so a throw or
      // rejection here is a backstop, not the live error path (that
      // path is ``lastFlushFailed`` below).
      console.error("Section flush before leave failed:", err);
      flushThrew = true;
    } finally {
      if (ownBusy) this._saving = false;
    }
    // Two distinct failure signals. The throw backstop only arms
    // the prompt (fail conservative on an unknown state); the latch
    // additionally gates Save, read live at each decision because
    // the dialog can stay open across a reload timer's hydrate that
    // clears it along with the failed edit it protected — a stale
    // snapshot would refuse a leave over an edit that no longer
    // exists. A one-off throw does NOT gate Save: ``_saveYaml``
    // re-runs the flush for real, so either its retry lands the
    // edit (leaving is correct) or it fails again and ``saved``
    // already blocks the leave.
    const latched = () => this._activeSection?.lastFlushFailed ?? false;
    const ok = await this._unsavedGuard.run({
      dirty: flushThrew || latched() || this._isDirty,
      open: () => this._unsavedDialog?.open(),
      save: async () => {
        // ``_saveYaml`` may open the validation prompt and await
        // the user's choice. If they pick Cancel or Go to error,
        // it resolves ``false`` and we propagate that up — the
        // user isn't done editing, so the page-leave guard
        // shouldn't proceed with navigation.
        const saved = await this._saveYaml();
        if (!saved) return false;
        if (latched()) {
          // The failed round's edit never reached the buffer and a
          // settled round cannot be re-run, so "Save" must not
          // pretend it saved it. Stay put — the editor still holds
          // the form state — and say why the leave didn't happen.
          notifyError(this._localize("device.leave_last_change_unsaved"));
          return false;
        }
        return true;
      },
    });
    return ok;
  };

  private _onBeforeUnload = (e: BeforeUnloadEvent) => {
    // Synchronous by contract — the browser reads the decision on
    // return, so the async flush cannot be awaited here. Safe
    // regardless: ``_sectionDirty`` arms ``_isDirty`` from the
    // first keystroke, and ``lastFlushFailed`` covers a round
    // already settled as failed, so the warning fails
    // conservative (#1503).
    this._kickSectionFlush();
    if (this._isDirty || this._activeSection?.lastFlushFailed) {
      e.preventDefault();
      e.returnValue = "";
    }
  };

  async connectedCallback() {
    super.connectedCallback();
    void this._loadPreferences();
    window.addEventListener("beforeunload", this._onBeforeUnload);
    window.addEventListener("keydown", this._onKeydown);
    this._mql.addEventListener("change", this._onMqlChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("beforeunload", this._onBeforeUnload);
    window.removeEventListener("keydown", this._onKeydown);
    this._mql.removeEventListener("change", this._onMqlChange);
    // Drop any in-flight unsaved-changes guard so its caller's
    // ``await`` doesn't dangle past unmount — resolve as "don't
    // proceed" since the page is going away anyway.
    this._unsavedGuard.cancelPending();
  }

  private _onKeydown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    /* If a deeper component (open dialog, autocomplete dropdown,
       etc.) already handled this Esc, don't also navigate back.
       Mirrors the EscapeController guard so the leave-page
       behaviour only fires when nothing else has claimed the key. */
    if (e.defaultPrevented) return;
    /* Don't intercept Esc while the user is typing — the YAML editor,
       text inputs, and contentEditable surfaces all use Esc for their
       own behaviour (closing autocomplete, dropping focus, etc.).
       composedPath()[0] is the actual focused element across shadow
       boundaries; e.target gets retargeted to the host. */
    const target = e.composedPath()[0] as HTMLElement | undefined;
    if (isTypingTarget(target)) return;
    if (this._drawerOpen) {
      e.preventDefault();
      this._drawerOpen = false;
      return;
    }
    // Otherwise leave via goBackOrHome(), which prompts before the pop.
    e.preventDefault();
    void goBackOrHome();
  };

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("id") && this.id) {
      // Consume the wizard's "just-created" handoff once per id. Each
      // call to consumeJustCreated atomically reads + clears the flag,
      // so a refresh or back-nav won't re-show the banner.
      this._justCreated = consumeJustCreated(this.id);
      // New device id ⇒ different board; drop the cached one so the
      // next fetch can repopulate.
      this._loadedBoardId = null;
      this._board = null;
      this._platformReady = false;
      // Don't carry the prior device's error badges: the diagnostics
      // handler ignores results for other configurations, so these
      // would linger until the new device's first lint pass.
      if (this._backendErrors.length) this._backendErrors = [];
      this._heldUnknownInstance = null;
      this._kickKnownKeys();
      // The loading gate detaches the editor subtree, so the section
      // editor's unmount announcement never reaches this page — drop the
      // captured ref and its dirty bit here instead.
      this._activeSection = null;
      this._sectionDirty = false;
      // Discard leaves the buffer dirty; clear it or the prior device's
      // YAML rides the reused element and Save writes it to this file.
      this._yaml = "";
      this._savedYaml = "";
      void this._load.start();
    }
    // Devices context arrives async after connect; kick off the board
    // fetch as soon as we have a `board_id` (and re-fetch only when it
    // actually changes).
    const boardId = this._device?.board_id ?? null;
    if (boardId && boardId !== this._loadedBoardId) {
      this._loadedBoardId = boardId;
      // Drop the previous board now so derived props
      // (``.platform``, ``.boardName``) don't lag the in-flight
      // ``board_id``. Restored on success, left null on failure.
      this._board = null;
      this._platformReady = false;
      void this._loadBoard(boardId);
    } else if (!boardId) {
      // No manifest to fetch (device has no ``board_id`` or our
      // id isn't in the loaded context — deleted / stale link).
      // Gate on ``_devicesLoaded`` rather than ``_devices.length
      // > 0`` so a zero-device dashboard still releases. Known
      // transient: a wizard-just-created device flips the gate
      // here once with ``platform=""``, then the device-add
      // event refires it with the real platform — self-correcting
      // one-extra-fetch in that narrow window.
      if (this._loadedBoardId !== null) {
        this._loadedBoardId = null;
        this._board = null;
      }
      if (this._device !== null || this._devicesLoaded) {
        this._platformReady = true;
      }
    }
  }

  /** Lets the user dismiss the welcome banner without leaving the page. */
  private _dismissJustCreated = () => {
    this._justCreated = false;
  };

  /**
   * Swap the device's board to the picked alternate. `devices/update`
   * writes only the sidecar `board_id` (the YAML keeps its `board:`),
   * so no reload is needed — the header refreshes itself via the
   * `DEVICE_UPDATED` event.
   */
  private _onChangeBoard = async (e: CustomEvent<{ boardId: string }>) => {
    const boardId = e.detail?.boardId;
    const device = this._device;
    if (!boardId || !device || boardId === device.board_id) return;
    // An unsaved buffer may disagree with the board being applied.
    if (this._isDirty) {
      notifyError(this._localize("device.change_board_unsaved"));
      return;
    }
    await applyBoardChange(this._api, this._localize, device.configuration, boardId);
  };

  private _readStoredLayout(): DeviceLayoutMode | null {
    const stored = localStorage.getItem("esphome-editor-layout");
    return stored === "both" || stored === "left" || stored === "right" ? stored : null;
  }

  private async _loadPreferences() {
    // localStorage is the instant per-browser seed; the backend pref below is
    // the durable cross-browser source when localStorage is empty.
    const savedLayout = this._readStoredLayout();
    if (savedLayout) {
      this._layout = savedLayout;
    }

    try {
      const prefs = await this._api.getPreferences();
      this._navCollapsed = !prefs.navigator_visible;
      // No local layout yet (new browser): restore the backend choice, which
      // defaults to the split view on a fresh install. Re-check after the
      // await: a toggle during the in-flight fetch writes a valid value that
      // must win, but a stale invalid value still seeds from the backend.
      if (!savedLayout && this._readStoredLayout() === null) {
        this._layout = prefToDeviceLayout(prefs.device_editor_layout);
      }
    } catch (err) {
      // Preferences not critical; fall back to defaults. Logged so a YAML
      // user silently dropped into the non-YAML first-open layout is
      // diagnosable.
      console.warn("Failed to load device preferences:", err);
    }
  }

  private async _loadBoard(boardId: string) {
    try {
      // Single-board lookup keyed off the BE-resolved `board_id` —
      // avoids paging the full catalog when we only ever consume one
      // board on the device editor. The BE handles deriving board_id
      // from YAML on its side (see `_resolve_board_id`), so we don't
      // need a YAML-regex fallback here.
      const board = await fetchBoard(this._api, boardId);
      // Guard against late responses overwriting a newer fetch — if
      // the user navigated to another device while this was in flight,
      // `_loadedBoardId` will already point at the new id.
      if (this._loadedBoardId === boardId) {
        this._board = board;
        this._platformReady = true;
      }
    } catch (e) {
      console.error("Failed to load board:", e);
      // Drop any stale ``_board`` so the navigator doesn't
      // resolve labels against the wrong platform, then release
      // the gate (labels come up with ``platform=undefined``).
      if (this._loadedBoardId === boardId) {
        this._board = null;
        this._platformReady = true;
      }
    }
  }

  /**
   * Consume the one-shot ``?line=`` intent once the YAML has loaded.
   *
   * Direct-link arrivals from the dashboard's YAML hit list
   * carry only ``?line=N`` (not ``?section=``); the navigator's
   * highlight + scroll path keys off ``_selectedSection``, so
   * without a section the editor mounts but never scrolls. Walk
   * the just-loaded YAML to find the section that contains line
   * N and pin both ``_selectedSection`` and ``_scrollToHighlight``
   * — the navigator's existing emit-on-update logic then fires
   * the scroll-into-view dispatch in CodeMirror. The focus paths
   * deep-target the line's field in the structured editor, and
   * ``_selectedFromLine`` is pinned to the section's own start so
   * the arrival is state-identical to a live caret move onto the
   * line (instance disambiguation, same-section move checks).
   */
  private _maybeResolveLineFromUrl() {
    if (this._pendingUrlLine === undefined || !this._yaml) return;
    const line = this._pendingUrlLine;
    this._pendingUrlLine = undefined;
    const resolved = resolveUrlLineFocus(this._yaml, line, this._selectedSection);
    if (!resolved) return;
    this._selectedSection = resolved.sectionKey;
    this._selectedFromLine = resolved.sectionFromLine;
    this._focusFieldPath = resolved.fieldPath;
    this._focusYamlPath = resolved.yamlPath;
    // ``_highlightRange`` is what the editor reads to drive
    // scroll-into-view; the user-click path sets it via
    // ``_onYamlHighlight`` from the navigator's ``yaml-highlight``
    // event, but the navigator's update-from-prop-change path
    // doesn't emit, so URL-only arrivals would otherwise mount
    // the editor without ever scrolling.
    this._setHighlight(resolved.range, true);
  }

  /** Promise resolver wired up while the validation dialog is open.
   *
   *  ``_saveYaml`` returns a Promise that the unsaved-changes guard
   *  awaits; when validation passes (or the dialog isn't shown)
   *  that Promise resolves immediately. When the dialog opens, the
   *  resolution is deferred until the user picks an exit:
   *  ``Save anyway`` → ``true`` (proceed with the leave),
   *  ``Cancel`` / ``Go to error`` → ``false`` (stay put — the user
   *  isn't done editing). */
  private _pendingValidationResolve: ((saved: boolean) => void) | null = null;

  /**
   * Save the YAML buffer to the backend, gated by a save-time
   * validation prompt when the backend reports errors.
   *
   * Resolves to ``true`` when the buffer was committed (either
   * directly or via the prompt's "Save anyway"), ``false`` when
   * the user cancelled the prompt or asked to be jumped to the
   * error. The unsaved-changes page-leave guard reads this
   * boolean to decide whether to proceed with navigation —
   * silently proceeding on a deferred-or-cancelled save would
   * leave the user with their dirty buffer abandoned on the
   * other side of a page transition.
   *
   * Also resolves ``true`` for the no-op "save when not dirty"
   * case (the guard treats that as "nothing to save, fine to
   * leave" — unless the editor's ``lastFlushFailed`` says the
   * buffer is clean only because a failed round never landed,
   * which the leave guard checks separately); the page's
   * user-facing Save button doesn't read the return value.
   */
  private _saveYaml = async (): Promise<boolean> => {
    // Refuse to start a second save while one is already in progress.
    // The Save button's disabled attribute blocks the mouse, but
    // Cmd/Ctrl+S (SaveShortcutController, bound on window) only checks
    // dirtiness — and ``_savedYaml`` stays stale both through the
    // multi-second validate phase and while the validation-error
    // dialog awaits the user, so the buffer keeps reading dirty.
    // ``_pendingValidationResolve`` is non-null exactly while that
    // dialog is open; guarding on it too stops a keystroke from
    // double-validating, double-writing, or resolving the open
    // prompt's pending promise out from under it.
    if (this._saving || this._pendingValidationResolve !== null) return false;
    // Mark the Save button busy up front so it acknowledges the
    // click immediately. The slow phases that follow are the
    // section-editor flushPending (a backend upsert for the
    // automation/script editors) and the validate round-trip on a
    // large config; both deserve the spinner.
    this._saving = true;
    // Everything from here runs inside try/finally so any throw — most
    // notably a flushPending backend upsert that rejects — clears the
    // busy flag instead of stranding ``_saving=true``, which the guard
    // above would then read as a permanent in-progress save and brick
    // every later attempt. The not-dirty bail and the validation-dialog
    // branch return through this finally too, stopping the spinner while
    // the prompt waits on the user. The commit path uses ``return
    // await`` so the finally fires only after _doSaveYaml settles, not
    // the moment it's called — _doSaveYaml owns ``_saving`` across the
    // write (and on the standalone "Save anyway" path), so the flag
    // stays true with no await between, and the button never flickers.
    try {
      // Promote any in-flight form keystroke (still inside its 200ms
      // debounce window) into ``_yaml`` so the save commits exactly
      // what the user typed — not what was last flushed. The
      // component editor's flushPending is sync (local YAML splice
      // only); the automation/script editors return a Promise
      // because their pending change is a backend upsert call.
      // ``await`` handles both shapes — awaiting ``undefined``
      // resolves immediately.
      await this._activeSection?.flushPending();
      // The Save button activates on ``_isDirty`` (yaml diff OR the
      // section editor's transient pre-flush dirty flag), so a click
      // inside the debounce window can land here with the form
      // marked dirty but the post-flush yaml unchanged from the
      // saved buffer (e.g. user typed and undid a character, or the
      // splice normalised to the same serialisation). Bail before
      // toasting / hitting the backend — neither has anything to do.
      if (!this._isYamlDirty) return true;

      // Re-validate against the backend before committing. The
      // editor's inline linter runs the same call on a 600ms
      // debounce, but a save click inside that window would
      // otherwise commit invalid YAML against a stale "no
      // diagnostics" snapshot. Authoritative re-check here, then
      // the prompt only opens when the freshly-saved buffer really
      // is invalid.
      //
      // Network / backend failures fall through to the save —
      // we'd rather risk an unvalidated commit than block the user
      // on a backend hiccup. The fall-through stays silent (no
      // ``toast.error`` here): the actual ``updateConfig`` call
      // below is the authority on whether the save worked, and a
      // toast at this layer would shout-down its result.
      if (this.id) {
        try {
          // Reuse the linter's last result when it matches the
          // current buffer exactly — saves a WS round-trip and an
          // ESPHome validate pass that just ran in the background.
          const res =
            getLastValidatedResult(this.id, this._yaml) ??
            (await this._api.validateYaml(this.id, this._yaml));
          const summary = summarizeValidation(res, this._yaml, this._localize);
          if (summary.count > 0) {
            this._validationErrorCount = summary.count;
            this._validationFirstLine = summary.first?.line ?? 0;
            this._validationFirstCol = summary.first?.col ?? 0;
            this._validationFirstMessage = summary.first?.message ?? "";
            // The reported line is meaningless against the open buffer when
            // the error is inside an `!include`d file; name that file instead
            // of leaving the editor to navigate nowhere.
            const errorFile = summary.first?.file ?? null;
            this._validationFirstFile =
              errorFile && this.id && !isOpenConfigFile(errorFile, this.id)
                ? basename(errorFile)
                : "";
            // The re-entrancy guard at the top of _saveYaml bails while a
            // prompt is already pending, so the resolver is null here and
            // can be assigned fresh without dangling a prior caller.
            return new Promise<boolean>((resolve) => {
              this._pendingValidationResolve = resolve;
              this._yamlValidationDialog.open();
            });
          }
        } catch (e) {
          console.debug("[save-yaml] validate_yaml failed, saving anyway:", e);
        }
      }

      return await this._doSaveYaml();
    } finally {
      this._saving = false;
    }
  };

  /** Commit the current ``_yaml`` to the backend.
   *
   *  Split out from ``_saveYaml`` so the save-time validation
   *  prompt's "Save anyway" button can re-enter the same write
   *  without re-validating. Both call sites have already
   *  verified ``_isYamlDirty``; this method intentionally does
   *  not re-check it.
   *
   *  Awaits the backend round-trip before toasting success — a
   *  fire-and-forget toast would race with the rejection path
   *  and the user would see "Saved" → "Failed to save" in
   *  succession when the backend rejects an invalid YAML the
   *  pre-validation step missed (issue #436). On failure
   *  ``_savedYaml`` is rolled back so the dirty indicator
   *  reappears and the user can retry.
   */
  private _doSaveYaml = async (): Promise<boolean> => {
    // Optimistic local commit: flip ``_savedYaml`` immediately so
    // ``_isYamlDirty`` reads false while the backend write is in
    // flight. Roll back if the write fails so the page doesn't
    // claim "saved" against a buffer the backend rejected.
    const prevSavedYaml = this._savedYaml;
    this._savedYaml = this._yaml;
    this._saving = true;
    let saved = true;
    try {
      await this._api.updateConfig(this.id, this._yaml);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // Command timeouts get the success path: the backend
      // likely wrote the file but its response didn't make it
      // back before the WS timeout. Same lenient policy as
      // before the issue #436 fix.
      if (!msg.includes("timed out")) {
        saved = false;
        // Genuine failure — restore the prior savedYaml so the
        // dirty indicator returns and the user can fix and retry.
        this._savedYaml = prevSavedYaml;
        console.error("Failed to save YAML:", e);
      }
    } finally {
      this._saving = false;
    }
    // A committed save ends the fix-the-error errand the error-jump
    // highlight was guiding (validation passed, or the user chose
    // "Save anyway"), so drop it. A failed save keeps it.
    if (saved && this._errorHighlight !== "none") {
      this._setHighlight(null, false);
    }
    const message = saved ? "device.yaml_saved" : "device.yaml_save_error";
    const variant = saved ? notifySuccess : notifyError;
    variant(this._localize(message));
    if (saved) void this._maybePromptBoardReselect();
    return saved;
  };

  /** The parsed YAML platform block when it names a different chip than
   *  the selected board, else null. */
  private _boardDisagreement() {
    if (!this._board) return null;
    const parsed = readPlatformBoard(this._yaml);
    return parsed && boardDisagreesWithYaml(parsed, this._board) ? parsed : null;
  }

  private _openBoardReselect(): Promise<boolean> {
    return openBoardReselect(this._boardReselectDialog, {
      configuration: this.id,
      yaml: this._yaml,
    });
  }

  /** Offer to reselect the stored board when the saved YAML names a
   *  different chip — the stale `board_id` would dead-end the Web
   *  Serial chip check. */
  private async _maybePromptBoardReselect(): Promise<void> {
    if (this._suppressBoardPrompt) return;
    const parsed = this._boardDisagreement();
    if (!parsed) return;
    const key = `${this.id}|${parsed.platform}|${parsed.board}|${parsed.variant}`;
    if (this._boardPromptShownFor === key) return;
    // Record up front so a save during the open can't double-fire, but
    // un-record when nothing opened (transient fetch failure) so the
    // next save re-offers the prompt.
    this._boardPromptShownFor = key;
    const opened = await this._openBoardReselect().catch((err) => {
      console.error("Board reselect prompt failed:", err);
      return false;
    });
    if (!opened && this._boardPromptShownFor === key) {
      this._boardPromptShownFor = null;
    }
  }

  /** Chip-mismatch recovery hand-off from the install dialog. */
  private _onRequestChangeBoard = (e: CustomEvent<{ configuration: string }>) => {
    // Hand over the buffer only when it matches the saved config; a
    // dirty buffer would resolve candidates the backend doesn't hold.
    const cleanBuffer = e.detail.configuration === this.id && !this._isDirty;
    void openBoardReselect(this._boardReselectDialog, {
      configuration: e.detail.configuration,
      yaml: cleanBuffer ? this._yaml : undefined,
    });
  };

  private _onValidationSaveAnyway = async () => {
    const saved = await this._doSaveYaml();
    this._resolveValidationPrompt(saved);
  };

  /** Drop the user at the first failing diagnostic via the same
   *  highlight + scroll-into-view path the dashboard's ``?line=N``
   *  arrival uses. ``resolveSectionForUrlLine`` switches the
   *  navigator's selection to the containing section so the user
   *  isn't left looking at a different section's form panel after
   *  the scroll lands. */
  private _onValidationGoTo = (e: CustomEvent<{ line: number; col: number }>) => {
    this._jumpToErrorLine(e.detail.line);
    // The user wants to fix the error, not leave with it unsaved
    // — resolve as "not saved" so the page-leave guard stays put.
    this._resolveValidationPrompt(false);
  };

  /** Jump-to from the live error banner (esphome-device-editor's goto-line). */
  private _onEditorGoToLine = (e: CustomEvent<{ line: number }>) => {
    this._jumpToErrorLine(e.detail.line);
  };

  /** Highlight, scroll to, and switch section for an error's 1-indexed line. */
  private _jumpToErrorLine(line: number) {
    if (!line || line < 1) return;
    // Sections-only layout would scroll a hidden editor — flip
    // to the split view so the user actually sees where they're
    // landing. Implicit expand to reveal the error: cache it locally
    // but don't record it as the user's durable layout preference.
    if (this._layout === "left") {
      this._cacheLayout("both");
    }
    this._setHighlight({ fromLine: line, toLine: line }, true, true);
    const resolved = resolveSectionForUrlLine(this._yaml, line);
    if (resolved) {
      this._selectedSection = resolved.sectionKey;
    }
  }

  /** Light-dismiss / close-button / Cancel button on the
   *  validation prompt — fall through here so the page-leave
   *  guard sees a definitive "not saved" answer. Without this
   *  the prompt's dismiss path would dangle the resolver
   *  Promise forever. */
  private _onValidationCancel = () => {
    this._resolveValidationPrompt(false);
  };

  private _resolveValidationPrompt(saved: boolean) {
    const resolve = this._pendingValidationResolve;
    this._pendingValidationResolve = null;
    resolve?.(saved);
  }

  private _onValidateClick = () => {
    if (!this._device) return;
    this._commandDialog.configuration = this._device.configuration;
    this._commandDialog.name = this._device.friendly_name || this._device.name;
    this._commandDialog.open("validate");
  };

  // Persist the editor buffer before building — install/compile build the
  // on-disk file, so an unsaved edit would flash the previous version. A
  // click while a job already runs re-attaches to it instead: no save (the
  // edit stays in the buffer), no second job.
  private _installAfterSave = async (run: () => void | Promise<void>): Promise<void> => {
    if (this._showActiveJobProgress()) return;
    let saved: boolean;
    this._suppressBoardPrompt = true;
    try {
      saved = await this._saveYaml();
    } catch (e) {
      // _saveYaml rejects when a section editor's flushPending upsert fails;
      // surface it and abort rather than leak an unhandled rejection.
      console.error("Failed to save before install:", e);
      notifyError(this._localize("device.yaml_save_error"));
      return;
    } finally {
      this._suppressBoardPrompt = false;
    }
    if (!saved) return;
    // Hard block: an unresolved YAML/board disagreement dead-ends the
    // install chip check, so force the fix before offering install
    // methods. Dismissing the picker keeps install blocked; the next
    // click re-prompts. When the picker has nothing to offer (no
    // catalog candidates, or a transient failure) fall through — the
    // chip check downstream stays the guard, and blocking here would
    // strand the install with only a toast.
    if (this._boardDisagreement() && (await this._openBoardReselect())) {
      return;
    }
    try {
      await run();
    } catch (err) {
      // Surfaced rather than lost as an unhandled rejection.
      console.error("Install entry failed:", err);
      notifyError(this._localize("device.install_start_failed"));
    }
  };
  private _saveThenInstall = () => this._installAfterSave(this._installCtrl.onInstall);
  private _saveThenUpdate = () => this._installAfterSave(this._installCtrl.onUpdate);

  /** Re-attach the command dialog to this device's running job; true when one existed. */
  private _showActiveJobProgress(): boolean {
    return followActiveJob(
      this._activeJobs,
      this.id,
      this._commandDialog,
      this._devices,
      this._localize
    );
  }

  /** Catch ``clean-build`` from the install dialog's post-failure
   *  hint and route it through this page's command-dialog —
   *  mirrors dashboard's page-level handler so the "clean the
   *  build files for this device" link works the same way on
   *  the device page. */
  private _onCleanBuild = (e: CustomEvent<ConfiguredDevice>) => {
    this._cleanBuild(e.detail);
  };

  /** "Logs" from the editor's device-actions menu. */
  private _onEditorOpenLogs = () => this._installCtrl.onLogs();

  /** "Clean build files" from the editor's device-actions menu. */
  private _onEditorCleanBuild = () => {
    if (this._device) this._cleanBuild(this._device);
  };

  private _cleanBuild(device: ConfiguredDevice) {
    this._commandDialog.configuration = device.configuration;
    this._commandDialog.name = device.friendly_name || device.name;
    this._commandDialog.open("clean");
  }

  /** Catch ``request-open-editor`` from the post-validation-failure
   *  hint. ``stopPropagation`` to prevent any future higher-level
   *  listener from also acting on the event. Two cases:
   *
   *  * Same device — already on the right editor; the dialog
   *    closing itself is the whole UX, no navigation needed.
   *  * Different device — shouldn't happen in practice (the
   *    dialogs only ever surface for the current page's device),
   *    but defensively navigate to the requested device so the
   *    hint can never become a silent no-op. */
  private _onRequestOpenEditor = (e: CustomEvent<{ configuration: string }>) => {
    e.stopPropagation();
    if (e.detail.configuration === this._device?.configuration) return;
    void navigate(`/device/${encodeURIComponent(e.detail.configuration)}`);
  };

  static styles = [espHomeStyles, loadMessageStyles, devicePageStyles];

  protected render() {
    const deviceTitle =
      this._device?.friendly_name ||
      this._device?.name ||
      this.id ||
      this._localize("dashboard.create_device");

    const showEdgeTab = this._isMobile ? !this._drawerOpen : this._navCollapsed;
    const backLabel = this._localize("device.back");

    return html`
      <!-- Mobile drawer -->
      <div
        class="drawer-backdrop ${this._drawerOpen ? "drawer-backdrop--open" : ""}"
        @click=${() => {
          this._drawerOpen = false;
        }}
      ></div>
      <div
        class="drawer ${this._drawerOpen ? "drawer--open" : ""}"
        @section-toggle=${this._onSectionToggle}
        @section-reveal=${this._onSectionReveal}
        @section-select=${this._onSectionSelect}
        @yaml-highlight=${this._onYamlHighlight}
        @yaml-updated=${this._onYamlUpdated}
        @yaml-draft=${this._onYamlDraft}
        @nav-collapse=${this._onNavCollapse}
      >
        ${this._load.state === "ready" ? this._renderNavigator("drawer-nav") : nothing}
      </div>

      <div class="page">
        <div
          class=${classMap({
            "layout-grid": true,
            "nav-collapsed": this._navCollapsed,
            "load-state": this._load.state !== "ready",
          })}
          @section-toggle=${this._onSectionToggle}
          @section-reveal=${this._onSectionReveal}
          @layout-change=${this._onLayoutChange}
          @yaml-change=${this._onYamlChange}
          @yaml-diagnostics=${this._onYamlDiagnostics}
          @yaml-cursor-line=${this._onYamlCursorLine}
          @yaml-user-edit=${this._onYamlUserEdit}
          @yaml-highlight=${this._onYamlHighlight}
          @yaml-updated=${this._onYamlUpdated}
          @yaml-draft=${this._onYamlDraft}
          @section-select=${this._onSectionSelect}
          @section-mount=${this._onSectionMount}
          @section-unmount=${this._onSectionUnmount}
          @field-focus=${this._onFieldFocus}
          @dirty-change=${this._onSectionDirtyChange}
          @nav-section-show=${this._onNavSectionShow}
          @nav-collapse=${this._onNavCollapse}
          @save-yaml=${this._saveYaml}
          @validate-device=${this._onValidateClick}
          @install-device=${this._saveThenInstall}
          @update-device=${this._saveThenUpdate}
        >
          ${cache(
            this._load.state === "ready"
              ? this._renderEditor(deviceTitle, showEdgeTab, backLabel)
              : this._renderLoadState()
          )}
        </div>
        <esphome-unsaved-changes-dialog
          @discard=${this._onUnsavedDiscard}
          @save=${this._onUnsavedSave}
          @cancel=${this._onUnsavedCancel}
        ></esphome-unsaved-changes-dialog>
        <esphome-command-dialog
          @request-show-logs-after-install=${this._onPostInstallShowLogs}
          @request-open-editor=${this._onRequestOpenEditor}
        ></esphome-command-dialog>
        <esphome-firmware-install-dialog
          @request-show-logs-after-install=${this._onPostInstallShowLogs}
          @clean-build=${this._onCleanBuild}
          @request-open-editor=${this._onRequestOpenEditor}
          @request-change-board=${this._onRequestChangeBoard}
        ></esphome-firmware-install-dialog>
        <esphome-logs-dialog></esphome-logs-dialog>
        <esphome-install-method-dialog
          ?open=${this._installCtrl.installMethodOpen}
          .deviceState=${this._installCtrl.deviceState}
          .deviceTargetPlatform=${this._installCtrl.deviceTargetPlatform}
          .deviceCurrentAddress=${this._installCtrl.deviceCurrentAddress}
          .canFlashBootloader=${this._installCtrl.canFlashBootloader}
          .neverFlashed=${this._installCtrl.neverFlashed}
          .mode=${this._installCtrl.methodMode}
          @close=${this._installCtrl.onInstallMethodClose}
          @select-method=${this._installCtrl.onInstallMethodSelect}
        ></esphome-install-method-dialog>
        <esphome-yaml-validation-dialog
          .errorCount=${this._validationErrorCount}
          .firstErrorLine=${this._validationFirstLine}
          .firstErrorCol=${this._validationFirstCol}
          .firstErrorMessage=${this._validationFirstMessage}
          .firstErrorFile=${this._validationFirstFile}
          @save-anyway=${this._onValidationSaveAnyway}
          @goto=${this._onValidationGoTo}
          @cancel=${this._onValidationCancel}
        ></esphome-yaml-validation-dialog>
        <esphome-board-reselect-dialog></esphome-board-reselect-dialog>
      </div>
    `;
  }

  /** Step one section back along the user's visit trail. With no
   *  trail left we land on the board-info / next-steps view. Leaving
   *  the device entirely is the app-shell's top-left back button —
   *  not this one. */
  private _onBack = () => {
    this._heldUnknownInstance = null;
    const prev = this._sectionHistory.length
      ? this._sectionHistory[this._sectionHistory.length - 1]
      : null;
    if (prev) {
      this._sectionHistory = this._sectionHistory.slice(0, -1);
      this._selectedSection = prev.key;
      // History entries were recorded against an older buffer;
      // re-resolve (#1470). A vanished key leaves the line unset
      // rather than pointing at whatever now sits on the stale line.
      this._selectedFromLine = resolveCurrentSectionLine(
        this._yaml,
        prev.key,
        prev.fromLine
      );
    } else {
      this._selectedSection = null;
      this._selectedFromLine = undefined;
    }
    this._setHighlight(null, false);
    this._updateUrl();
    this._kickSectionFlush();
  };

  /** Left-edge expand affordance. On mobile it opens the drawer; on
   *  desktop it un-collapses the navigator pane and persists that
   *  preference — same write path the in-navigator collapse chevron
   *  uses in reverse. */
  private _onNavExpand = () => {
    if (this._isMobile) {
      this._drawerOpen = true;
      return;
    }
    this._navCollapsed = false;
    this._api.updatePreferences({ navigator_visible: true }).catch(() => {});
  };

  /** Collapse request bubbling up from the navigator's own chevron.
   *  Mirrors ``_onNavExpand`` in reverse — mobile closes the drawer,
   *  desktop sets the collapsed preference. */
  private _onNavCollapse = () => {
    if (this._isMobile) {
      this._drawerOpen = false;
      return;
    }
    this._navCollapsed = true;
    this._api.updatePreferences({ navigator_visible: false }).catch(() => {});
  };

  /**
   * Accordion behaviour: clicking a closed section opens it and
   * closes all others; clicking an open section closes it. Keeping
   * exactly one (or zero) section visible at a time avoids piling
   * three long lists on top of each other in the navigator.
   */
  private _onSectionToggle(e: CustomEvent<{ index: number }>) {
    const { index } = e.detail;
    const next = new Set<number>();
    if (!this._openSections.has(index)) {
      // Closed → open. Wipe any other open sections first.
      next.add(index);
    }
    this._openSections = next;
    this._updateUrl();
  }

  /** Idempotently open the section holding an externally-selected row.
   *  A set, not a toggle: two navigators fire this and a toggle would
   *  race them into oscillating the section open/closed. */
  private _onSectionReveal(e: CustomEvent<{ index: number }>) {
    const { index } = e.detail;
    if (this._openSections.has(index)) return;
    this._openSections = new Set([index]);
    this._updateUrl();
  }

  /**
   * The board-info "Show core / components / automations" buttons
   * fire this. We make the matching section the only one expanded
   * in the navigator, un-collapse the desktop nav pane (in case the
   * user hid the whole sidebar earlier — they explicitly asked to
   * see something now), and on mobile slide the drawer open. The
   * navigator's three top-level groups are rendered in order
   * (core = 0, components = 1, automations = 2).
   */
  private _onNavSectionShow(e: CustomEvent<{ section: NavSectionName }>) {
    const indexBySection = { core: 0, components: 1, automations: 2 };
    const idx = indexBySection[e.detail.section];
    if (idx === undefined) return;
    const next = new Set<number>([idx]);
    this._openSections = next;
    this._updateUrl();
    this._drawerOpen = true;
    if (this._navCollapsed) {
      this._navCollapsed = false;
      // Persist so the nav stays open across reloads — same path the
      // toggle button takes when the user un-hides manually.
      this._api.updatePreferences({ navigator_visible: true }).catch(() => {});
    }
  }

  private _onLayoutChange(e: CustomEvent<DeviceLayoutMode>) {
    this._persistLayout(e.detail);
  }

  // Instant per-browser cache only; used for implicit layout changes (e.g.
  // auto-expanding to show a validation error) that shouldn't become the
  // user's durable cross-browser preference.
  private _cacheLayout(mode: DeviceLayoutMode) {
    this._layout = mode;
    localStorage.setItem("esphome-editor-layout", mode);
  }

  // A deliberate toggle: cache locally and record the cross-browser pref.
  private _persistLayout(mode: DeviceLayoutMode) {
    this._cacheLayout(mode);
    this._api
      .updatePreferences({ device_editor_layout: deviceLayoutToPref(mode) })
      .catch((err) => console.warn("Failed to persist device layout preference:", err));
  }

  /**
   * Both nav instances (drawer + desktop) share the same prop set
   * — only their CSS class differs. Pulled into a render helper
   * so adding a prop touches one place instead of drifting
   * across two copies.
   */
  private _renderNavigator(className: "drawer-nav" | "desktop-nav") {
    const isVisibleTourNavigator =
      className === "desktop-nav"
        ? !this._isMobile && !this._navCollapsed
        : this._isMobile && this._drawerOpen;
    return html`<esphome-device-navigator
      class=${className}
      .tourAnchorId=${isVisibleTourNavigator ? "nav" : undefined}
      .openSections=${this._openSections}
      .yaml=${this._yaml}
      .board=${this._board}
      .boardName=${this._board?.name ?? ""}
      .configuration=${this.id}
      .deviceName=${this._device?.name ?? ""}
      .platform=${this._board?.esphome.platform ?? ""}
      .platformReady=${this._platformReady}
      .selectedKey=${this._selectedSection}
      .selectedFromLine=${this._selectedFromLine}
      .errorCounts=${this._navErrorCounts(this._backendErrors, this._heldUnknownInstance)}
    ></esphome-device-navigator>`;
  }

  private _renderEditor(deviceTitle: string, showEdgeTab: boolean, backLabel: string) {
    return html` ${this._renderNavigator("desktop-nav")}
      <esphome-device-editor
        .yaml=${this._yaml}
        .savedYaml=${this._savedYaml}
        .layout=${this._layout}
        ?navCollapsed=${this._navCollapsed}
        .deviceTitle=${deviceTitle}
        .board=${this._board}
        .highlightRange=${this._highlightRange}
        .scrollToHighlight=${this._scrollToHighlight}
        .configuration=${this.id}
        .selectedSection=${this._selectedSection}
        .selectedFromLine=${this._selectedFromLine}
        .focusFieldPath=${this._focusFieldPath}
        .focusYamlPath=${this._focusYamlPath}
        .backendErrors=${this._instanceBackendErrors(
          this._backendErrors,
          this._selectedSection,
          this._selectedFromLine
        )}
        .justCreated=${this._justCreated}
        @just-created-dismiss=${this._dismissJustCreated}
        @request-install=${this._saveThenInstall}
        @request-migrate-config=${this._onMigrateConfig}
        @goto-line=${this._onEditorGoToLine}
        @change-board=${this._onChangeBoard}
        @open-logs=${this._onEditorOpenLogs}
        @clean-build=${this._onEditorCleanBuild}
        ?hasUnsavedEdits=${this._isDirty}
        ?saving=${this._saving}
        ?showModified=${this._device ? showPendingChanges(this._device) : false}
        ?showUpdate=${this._device ? showUpdateAvailable(this._device) : false}
        .installedVersion=${this._device?.runtime_state.deployed_version ?? ""}
        .availableVersion=${this._device?.current_version ?? ""}
        .webUiUrl=${this._device ? buildWebUiUrl(this._device) : ""}
        ?busy=${this._activeJobs.has(this.id)}
      >
        ${
          showEdgeTab || this._selectedSection
            ? html`<div slot="header-start" class="header-start-group">
                ${
                  showEdgeTab
                    ? html`<button
                        type="button"
                        class="ghost-icon-btn nav-toggle-btn"
                        ${tourAnchor("nav-toggle")}
                        @click=${this._onNavExpand}
                        title=${this._localize("device.show_navigator")}
                        aria-label=${this._localize("device.show_navigator")}
                      >
                        <wa-icon library="mdi" name="menu"></wa-icon>
                      </button>`
                    : nothing
                }
                ${
                  this._selectedSection
                    ? html`<button
                        class="ghost-icon-btn back-btn"
                        @click=${this._onBack}
                        title=${backLabel}
                        aria-label=${backLabel}
                      >
                        <wa-icon library="mdi" name="arrow-left"></wa-icon>
                      </button>`
                    : nothing
                }
              </div>`
            : nothing
        }
      </esphome-device-editor>`;
  }

  /** The editor's stand-in until the config lands. A gone config is
   *  terminal, so it offers a way out rather than a retry. */
  private _renderLoadState() {
    const loading = this._load.state === "loading";
    const missing = this._load.state === "missing";
    return renderAsyncState({
      loading,
      loadingMessage: this._localize("device.loading_config"),
      loadingLead: html`<wa-spinner></wa-spinner>`,
      error: loading
        ? null
        : this._localize(missing ? "device.load_not_found" : "device.load_failed"),
      errorActions: () =>
        html`<wa-button
          size="small"
          @click=${missing ? () => navigate("/") : this._load.retry}
        >
          ${this._localize(missing ? "device.back_to_dashboard" : "command.retry")}
        </wa-button>`,
      // The ready branch renders the editor instead of reaching here.
      content: () => nothing,
    });
  }

  /** Advance the YAML buffer. Any mutation while an error-jump
   *  highlight is active (YAML-pane typing, form drafts, completed
   *  component edits) arms the next lint pass to clear it. */
  private _setYaml(value: string) {
    this._yaml = value;
    if (this._errorHighlight === "active") this._errorHighlight = "edited";
  }

  private _onYamlChange(e: CustomEvent<{ value: string }>) {
    this._setYaml(e.detail.value);
    this._retryPendingFieldLine();
  }

  /** Inline lint pass completed. If the user has edited since jumping
   *  to the error, the highlight has served its purpose; clear it
   *  rather than leave a stale blue line the user can't dismiss
   *  (esphome/device-builder#1404). */
  private _onYamlDiagnostics(e: CustomEvent<YamlDiagnosticsDetail>) {
    if (e.detail.configuration !== this.id) return;
    if (this._errorHighlight === "edited") {
      this._setHighlight(null, false);
    }
    const next = resolveBackendErrors(this._yaml, e.detail.mapped);
    // Skip the steady state (valid config staying valid) so a lint pass
    // doesn't mint fresh identities and re-render the navigator for nothing.
    if (next.length || this._backendErrors.length) {
      this._backendErrors = next;
    }
  }

  /**
   * Cursor moved to a new line in the YAML pane. Find the section
   * that owns that line and select it so the navigator's
   * highlight follows the user's cursor (and the visual editor
   * loads the same section). Throttled to line transitions by
   * the editor itself; this handler runs once per traversed
   * section.
   *
   * Lines that fall in the gap between sections (a comment block,
   * a blank line, the file header above the first section) don't
   * match any range — leave the current selection alone in that
   * case rather than clearing it. The user-visible behaviour is
   * "scrolling through configured fields highlights them; cursor
   * resting in interstitial whitespace doesn't unhighlight what
   * was last clicked."
   *
   * Load-bearing event ordering: this handler reads `this._yaml`
   * to map the line to a section, but `this._yaml` is only
   * advanced when `_onYamlChange` runs. The editor's
   * `updateListener` dispatches `yaml-change` *before*
   * `yaml-cursor-line` within a single CM transaction (the
   * `update.docChanged` branch is checked first), so when the
   * user types Enter at end-of-line, this handler sees the
   * updated `_yaml` and the new line maps correctly. Swapping
   * the dispatch order in the editor would silently break the
   * cursor-follows-section path on every line-creating
   * keystroke — re-validate this assumption if you reorder the
   * `if` blocks in `yaml-editor.ts:_buildExtensions`'s
   * `updateListener`.
   */
  private _onYamlCursorLine(
    e: CustomEvent<{
      line: number;
      path?: string[];
      viaEdit?: boolean;
      indexedPath?: (string | number)[];
    }>
  ) {
    // The user is driving from the YAML pane now — drop any pending
    // form-field retry so it can't re-highlight after they've moved on.
    this._clearPendingFieldLine();
    const full = e.detail.path ?? [];
    // `sectionForCursor` falls back to the caret's key path when no section
    // range covers the line, so the panel follows the caret into a blank,
    // indented child line under a just-typed top-level block.
    const match = sectionForCursor(this._yaml, e.detail.line, full);
    if (!match) return;
    // MAP sections like substitutions render at an empty path, so their
    // fields are section-relative — the shared slice rule covers them.
    const rel = formRelativePath(full);
    const sectionKey = sectionKeyOf(match);
    if (
      sectionKey === this._selectedSection &&
      match.fromLine === this._selectedFromLine
    ) {
      // Same section: update the field target directly for intra-section
      // moves (the cross-section path below would no-op and freeze it).
      this._focusFieldPath = rel;
      this._focusYamlPath = e.detail.indexedPath;
      return;
    }
    // A doc edit that resolves an unknown top-level key is a key still
    // being typed (`sendx:` on its way to `sensor:`) — hold the switch so
    // the pane doesn't flip to the unknown-component error surface on
    // every keystroke (#2211). Clicks and caret moves (viaEdit false)
    // always switch, so a settled external component still opens its
    // pane deliberately. One quirk to know: the editor's same-line
    // throttle means clicking the held line itself emits no event; the
    // navigator entry (kept visible) is the release path there.
    if (e.detail.viaEdit === true) {
      // An unresolved key set (catalog still loading, or failed — retried
      // on the next device load, never from this hot path) means no holds.
      if (this._knownTopLevelKeys !== null && !this._knownTopLevelKeys.has(match.key)) {
        this._heldUnknownInstance = instanceKey(sectionKey, match.fromLine);
        return;
      }
    }
    this._heldUnknownInstance = null;
    // Cross-section: the switch is synchronous, so the click-time
    // coordinates are read against the click-time buffer; a draft
    // landing later re-pins the selection in ``_onYamlDraft``.
    this._selectedSection = sectionKey;
    this._selectedFromLine = match.fromLine;
    this._focusFieldPath = rel;
    this._focusYamlPath = e.detail.indexedPath;
    // The navigator selection follows the caret; a block highlight
    // left on the previously clicked component would disagree with
    // it (#1885). The highlight is a navigator/form affordance —
    // clear it rather than dragging it under the caret.
    this._clearBlockHighlight();
    this._updateUrl();
    this._kickSectionFlush();
  }

  /** The YamlSection backing the current selection, resolved by line
   *  (exact instance) then by key (single-instance / unset line). */
  private _focusedSection(): YamlSection | undefined {
    if (!this._selectedSection) return undefined;
    const sections = parseYamlTopLevelSections(this._yaml);
    return (
      (this._selectedFromLine !== undefined
        ? sections.find((s) => s.fromLine === this._selectedFromLine)
        : undefined) ?? sections.find((s) => sectionKeyOf(s) === this._selectedSection)
    );
  }

  /** Resolve *path* in the current section and highlight just its YAML line.
   *  Returns the section used (so callers can fall back to its range) and
   *  whether the exact line was found and highlighted. */
  private _highlightFieldLine(path: string[]): {
    section?: YamlSection;
    found: boolean;
  } {
    const section = this._focusedSection();
    const line = section ? findFieldLine(this._yaml, section, path) : null;
    if (line !== null) {
      this._setHighlight({ fromLine: line, toLine: line }, true);
    }
    return { section, found: line !== null };
  }

  /** Form field focused → highlight just that field's YAML line. */
  private _onFieldFocus(e: CustomEvent<{ path: string[] }>) {
    const path = (this._focusedFieldPath = e.detail.path);
    if (!path.length) return;
    const { section, found } = this._highlightFieldLine(path);
    if (found) {
      this._clearPendingFieldLine();
      return;
    }
    // Line not written yet (just-set icon / new id, debounced): highlight the
    // whole section meanwhile and queue a retry scoped to this section.
    this._pendingFieldLine = true;
    this._pendingFieldSection = {
      section: this._selectedSection,
      fromLine: this._selectedFromLine,
    };
    this._setHighlight(
      section ? { fromLine: section.fromLine, toLine: section.toLine } : null,
      section !== undefined
    );
  }

  /** Once the pending field's YAML line exists (debounced write landed),
   *  upgrade the highlight to that line — unless the user navigated away. */
  private _retryPendingFieldLine() {
    if (!this._pendingFieldLine || !this._focusedFieldPath?.length) return;
    if (
      this._pendingFieldSection?.section !== this._selectedSection ||
      this._pendingFieldSection?.fromLine !== this._selectedFromLine
    ) {
      this._clearPendingFieldLine();
      return;
    }
    if (this._highlightFieldLine(this._focusedFieldPath).found) {
      this._clearPendingFieldLine();
    }
  }

  private _clearPendingFieldLine() {
    this._pendingFieldLine = false;
    this._pendingFieldSection = undefined;
  }

  private _onYamlHighlight(
    e: CustomEvent<{ range: HighlightRange | null; scroll: boolean }>
  ) {
    this._setHighlight(e.detail.range, e.detail.scroll);
  }

  /** Hand edit in the YAML pane → drop the (now stale-ranged) highlight. */
  private _onYamlUserEdit() {
    this._clearBlockHighlight();
  }

  /** Clear a navigator/form block highlight; an error-jump highlight
   *  survives — only the next lint pass clears those. */
  private _clearBlockHighlight() {
    if (this._highlightRange && this._errorHighlight === "none") {
      this._setHighlight(null, false);
    }
  }

  /** Single write path for the editor highlight, so the error-jump
   *  flag can't leak into navigation / field-focus highlights. */
  private _setHighlight(range: HighlightRange | null, scroll: boolean, isError = false) {
    this._highlightRange = range;
    this._scrollToHighlight = scroll;
    this._errorHighlight = isError && range !== null ? "active" : "none";
  }

  private _onYamlUpdated(e: CustomEvent<YamlUpdatedDetail>) {
    /* ``yaml-updated`` fires from the three disk-writing delete
     * paths only (the automation editors' engine, the component
     * editor's section delete, and its manage-list row delete), all
     * via ``prepareSectionEvent``. Each ``await``s the write before
     * dispatching, so the new YAML is already on disk; ``basedOn``
     * is required so a future emitter cannot silently opt into the
     * clobbering replace.
     *
     * Form edits in the section editor flow through the separate
     * ``yaml-draft`` event (see ``_onYamlDraft`` below) which
     * advances only ``_yaml`` — those are committed via the right-
     * pane Save button. */
    const { configuration, yaml, basedOn } = e.detail;
    // A write landing after a device switch belongs to the previous
    // device — the router reuses this element, so acting on it would
    // splice the wrong device's buffer (#1489-style identity guard).
    if (configuration !== this.id) return;
    if (basedOn !== this._yaml) {
      // The write was computed against a buffer this pane has moved
      // past (a delete landing after a newer draft, #1476). Advance
      // the saved side and re-base the removal onto the live buffer
      // (#1490) so the retained draft no longer carries the deleted
      // section and a later wholesale Save cannot undo the deletion.
      // When the re-base cannot land (the section is unresolvable in
      // the moved buffer, or it moved again mid-recompute), fall back
      // to honestly dirty plus the visibility toast.
      this._savedYaml = yaml;
      void this._rebaseSupersededDelete(e.detail);
      return;
    }
    this._setYaml(yaml);
    this._savedYaml = yaml;
    this._repinSelection(yaml);
  }

  /** Re-pin the selection's line after a programmatic buffer rewrite
   *  (a landed delete, re-base, or draft shifts every section below
   *  its splice) so line-keyed lookups don't latch onto a neighbour
   *  (#1470). Hand edits stay out — the cursor-line handler owns the
   *  selection there. A vanished key leaves the line unset. */
  private _repinSelection(yaml: string): void {
    if (!this._selectedSection) return;
    const next = resolveCurrentSectionLine(
      yaml,
      this._selectedSection,
      this._selectedFromLine
    );
    if (next === this._selectedFromLine) return;
    // A pending field-line upgrade pinned to the pre-shift line
    // moves with the selection, or the retry's identity check would
    // abandon it over a foreign draft's line shift.
    if (
      this._pendingFieldSection !== undefined &&
      this._pendingFieldSection.fromLine === this._selectedFromLine
    ) {
      // A vanished key clears the upgrade — carrying ``undefined``
      // would keep the retry waiting forever on a section that no
      // longer exists.
      if (next === undefined) this._clearPendingFieldLine();
      else this._pendingFieldSection.fromLine = next;
    }
    this._selectedFromLine = next;
    // The URL persists the line; leaving it stale would bias a
    // reload's duplicate-key resolution toward the wrong instance.
    // A late anchored draft can land after this page unmounted —
    // replaceState would then pollute an unrelated route's URL.
    if (this.isConnected) this._updateUrl();
  }

  /** Apply a superseded delete's removal to the live buffer (#1490). */
  private async _rebaseSupersededDelete(detail: YamlUpdatedDetail): Promise<void> {
    const live = this._yaml;
    let rebased: string | null = null;
    try {
      rebased = await applyRemoval(detail, live, this._api);
    } catch (err) {
      console.error("Re-base of superseded delete failed:", err);
      rebased = null;
    }
    // The device switched mid-recompute: the continuation (and its
    // toast) belongs to the previous device. Bail before the buffer
    // comparison below can route it to the superseded toast.
    if (detail.configuration !== this.id) return;
    // Land the re-base only if the pane didn't move again while it
    // was computed — stale coordinates no longer apply.
    if (rebased !== null && live === this._yaml) {
      this._setYaml(rebased);
      this._repinSelection(rebased);
      return;
    }
    notifyInfo(this._localize("device.delete_superseded"), {
      description: this._localize("device.delete_superseded_detail"),
    });
  }

  private _onYamlDraft(e: CustomEvent<YamlDraftDetail>) {
    /* Form auto-sync: the section editor spliced its current
     * ``_values`` into the YAML and is asking us to surface that
     * in the YAML pane. Only ``_yaml`` advances; ``_savedYaml``
     * stays put so the right-pane Save button activates and the
     * user sees the buffer is dirty. */
    // A draft landing after a device switch belongs to the previous
    // device — the router reuses this element, so splicing it here
    // would put the old device's section into the new device's
    // buffer (the yaml-updated identity guard's sibling, #1479).
    if (e.detail.configuration !== this.id) return;
    // A late anchored draft (its editor already unmounted) computed
    // against a buffer this pane has moved past would clobber the
    // newer draft — drop it visibly. The active section is exempt:
    // its ``yaml`` prop legitimately lags its own last draft by a
    // render, and its splice re-carries the section's full values.
    const emitter: unknown = e.detail.node;
    if (e.detail.basedOn !== this._yaml && emitter !== this._activeSection) {
      notifyInfo(this._localize("device.draft_superseded"), {
        description: this._localize("device.draft_superseded_detail"),
      });
      return;
    }
    this._setYaml(e.detail.yaml);
    // Unconditional: at kick time the outgoing editor is still the
    // active section (Lit hasn't committed), and its synchronous
    // splice must re-pin the just-set selection. The typing stream
    // pays only a memoized parse — an own-section splice re-resolves
    // to the same line.
    this._repinSelection(e.detail.yaml);
    this._retryPendingFieldLine();
  }

  /** Migrate-nudge CTA: bring the draft up to date in one splice. */
  private async _onMigrateConfig() {
    // The splice is whole-file and line-coordinate based, so both the
    // device and the buffer must be exactly what the request was
    // computed against (the router reuses this element; typing or a
    // section draft advances `_yaml` mid-flight).
    const configuration = this.id;
    const basis = this._yaml;
    let yaml_diff: YamlDiff | null;
    try {
      ({ yaml_diff } = await this._api.migrateConfig(basis));
    } catch (err) {
      if (configuration === this.id) {
        notifyError(this._localize("device.config_migration_failed"), {
          description: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }
    if (configuration !== this.id) return;
    if (basis !== this._yaml) {
      notifyInfo(this._localize("device.draft_superseded"), {
        description: this._localize("device.draft_superseded_detail"),
      });
      return;
    }
    if (!yaml_diff) {
      notifyInfo(this._localize("device.config_migration_none"));
      return;
    }
    const newYaml = applyYamlDiff(basis, yaml_diff);
    this._setYaml(newYaml);
    this._repinSelection(newYaml);
    notifySuccess(this._localize("device.config_migration_applied"));
  }

  private _onSectionSelect(
    e: CustomEvent<{ sectionKey: string | null; fromLine?: number }>
  ) {
    const { sectionKey, fromLine } = e.detail;
    this._heldUnknownInstance = null;
    if (sectionKey === this._selectedSection && fromLine === this._selectedFromLine) {
      this._drawerOpen = false;
      return;
    }
    this._drawerOpen = false;
    // Back-stack bookkeeping: A → B pushes A so back returns to it.
    // Going back to no-section clears the trail — a later trip into
    // a section is a fresh navigation, not a continuation of the
    // last one. The null-to-X case (first selection of the session)
    // also leaves the stack untouched, which is what we want: back
    // from there should land on board info regardless.
    const prev = this._selectedSection;
    const prevLine = this._selectedFromLine;
    if (sectionKey === null) {
      this._sectionHistory = [];
    } else if (prev !== null) {
      this._sectionHistory = [...this._sectionHistory, { key: prev, fromLine: prevLine }];
    }
    this._selectedSection = sectionKey;
    // The navigator's rows can be one render behind a draft that
    // already advanced the buffer, so the click-time hint still
    // re-resolves against the live buffer (idempotent when they
    // agree, memo-cheap, unset when the key vanished); drafts
    // landing later re-pin via ``_onYamlDraft``.
    this._selectedFromLine =
      sectionKey !== null && fromLine !== undefined
        ? resolveCurrentSectionLine(this._yaml, sectionKey, fromLine)
        : undefined;
    // A navigator click carries no field intent — a stale cursor path
    // would scroll/flash a target in the newly mounted editor that the
    // user never pointed at.
    this._focusFieldPath = undefined;
    this._focusYamlPath = undefined;
    this._updateUrl();
    this._kickSectionFlush();
  }

  /** Start the outgoing section's flush without waiting for it.
   *
   *  The switch itself is synchronous — the section swap must never
   *  sit behind a backend round trip (#1479). The kick runs after
   *  the selection state changes but before Lit commits, so it
   *  still reaches the outgoing editor: the component editor's
   *  flush splices synchronously (its draft lands and re-pins the
   *  fresh selection via ``_onYamlDraft``), and the automation
   *  editors start their upsert, whose draft arrives later through
   *  the mount-time anchor with its basis checked on landing. This
   *  kick is the primary drain on every switch path; the engine's
   *  ``hostDisconnected`` drain covers only the unmounts nobody
   *  kicked (a YAML-pane edit removing the section, a reconnect
   *  reload, a device switch).
   *
   *  No unsaved-changes dialog: with auto-sync, the form's current
   *  ``_values`` are always already in the draft YAML buffer (or a
   *  round trip away, delivered by the anchor). The leave-page
   *  guard (``_confirmLeave``) is the only thing that prompts about
   *  unsaved YAML, since that's the only state actually at risk.
   *
   *  The deliberate trade (#1479): a buffer write landing inside
   *  the kicked round trip (typing in the next section or the YAML
   *  pane within the RTT) supersedes the late draft's basis, and
   *  the guard drops the old section's last debounce window of
   *  keystrokes with the visibility toast. The barrier prevented
   *  that ordering by stalling every switch instead; if the toast
   *  shows up in practice, the escalation is re-basing late drafts
   *  the way ``_rebaseSupersededDelete`` does for deletes. */
  private _kickSectionFlush(): void {
    // Navigation deliberately doesn't block on the flush; a failed
    // upsert already toasts, so just keep the cause diagnosable.
    try {
      void Promise.resolve(this._activeSection?.flushPending()).catch((err) =>
        console.error("Outgoing section flush failed:", err)
      );
    } catch (err) {
      console.error("Outgoing section flush failed:", err);
    }
  }

  /** Resolve the known-top-level-key set off the session-cached catalog.
   *  ``loadCatalog`` never rejects — a failed fetch resolves an empty index
   *  (null set) and resets its cache — so clearing the kicked flag only on
   *  that outcome allows a later retry without a per-keystroke refetch
   *  storm against an already-unhealthy backend. */
  private _kickKnownKeys(): void {
    if (this._catalogKicked) return;
    this._catalogKicked = true;
    void loadCatalog(this._api).then((catalog) => {
      this._knownTopLevelKeys = knownTopLevelKeys(catalog);
      if (this._knownTopLevelKeys === null) this._catalogKicked = false;
    });
  }

  private _onSectionMount = (e: HTMLElementEventMap["section-mount"]) => {
    this._activeSection = e.detail.node;
    this._sectionDirty = e.detail.node.dirty;
  };

  private _onSectionUnmount = (e: HTMLElementEventMap["section-unmount"]) => {
    if (this._activeSection === e.detail.node) {
      this._activeSection = null;
      this._sectionDirty = false;
    }
  };

  private _onSectionDirtyChange = (e: HTMLElementEventMap["dirty-change"]) => {
    // Identity-guarded like section-unmount: a late flip from a
    // previous editor (an in-flight upsert settling after a same-kind
    // retarget) must not overwrite the active section's dirty state.
    if (this._activeSection !== e.detail.node) return;
    this._sectionDirty = e.detail.dirty;
  };

  // ─── URL State Persistence ─────────────────────────────────

  private _readUrlParam(key: string, fallback: string): string;
  private _readUrlParam(key: string, fallback: null): string | null;
  private _readUrlParam(key: string, fallback: string | null): string | null {
    return readUrlParam(window.location.search, key, fallback);
  }

  private _readUrlLine(): number | undefined {
    return readUrlLine(window.location.search);
  }

  private _readUrlSections(): number[] {
    return readUrlSections(window.location.search);
  }

  private _updateUrl() {
    const newUrl = buildDeviceUrl(window.location.search, window.location.pathname, {
      selectedSection: this._selectedSection,
      selectedFromLine: this._selectedFromLine,
      openSections: this._openSections,
    });
    // Preserve the existing state object rather than nulling it: the
    // header back button's _goHome() reads history.state to tell an
    // in-app arrival ({} -> pop back to the filtered dashboard) from a
    // deep-link / fresh load (null -> navigate("/")). Replacing only the
    // URL keeps that distinction across section navigation.
    window.history.replaceState(window.history.state, "", newUrl);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-page-device": ESPHomePageDevice;
  }
}
