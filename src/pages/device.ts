import { consume } from "@lit/context";
import { mdiArrowLeft, mdiChevronRight, mdiMenu } from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../api/index.js";
import type { BoardCatalogEntry } from "../api/types/boards.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import type { FirmwareJob } from "../api/types/firmware-jobs.js";
import type { LocalizeFunc } from "../common/localize.js";
import type { ESPHomeCommandDialog } from "../components/command-dialog.js";
import type { NavSectionName } from "../components/device/device-board-info.js";
import type { DeviceLayoutMode } from "../components/device/device-editor.js";
// `NavSectionName` is consumed by the section-show event handler; the
// page itself doesn't pass it down anymore now that the step CTAs
// always render.
import { DeviceInstallController } from "../components/device/device-install-controller.js";
import type { ESPHomeDeviceSectionConfig } from "../components/device/device-section-config.js";
import type { ESPHomeFirmwareInstallDialog } from "../components/firmware-install-dialog.js";
import type { ESPHomeLogsDialog } from "../components/logs-dialog.js";
import type { ESPHomeUnsavedChangesDialog } from "../components/unsaved-changes-dialog.js";
import type { HighlightRange } from "../components/yaml-editor.js";
import type { ESPHomeYamlValidationDialog } from "../components/yaml-validation-dialog.js";
import {
  activeJobsContext,
  apiContext,
  devicesContext,
  devicesLoadedContext,
  localizeContext,
} from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { withBase } from "../util/base-path.js";
import { fetchBoard } from "../util/board-body-cache.js";
import { showPendingChanges, showUpdateAvailable } from "../util/device-sync.js";
import { deviceLayoutToPref, prefToDeviceLayout } from "../util/editor-layout.js";
import { consumeJustCreated } from "../util/just-created.js";
import { navigate, setLeaveGuard } from "../util/navigation.js";
import { postInstallShowLogsHandler } from "../util/post-install-logs.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { LIST_SECTIONS } from "../util/section-entry-overrides.js";
import { UnsavedGuard } from "../util/unsaved-guard.js";
import { resolveSectionForUrlLine } from "../util/url-line-resolver.js";
import { getLastValidatedResult } from "../util/yaml-lint-backend.js";
import {
  findFieldLine,
  parseYamlTopLevelSections,
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

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../components/command-dialog.js";
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
  private _selectedFromLine?: number = this._readUrlLine();

  /** Instance-relative field path the YAML cursor is on, for the form to
   *  scroll into view; empty on a section header / non-field line. */
  @state()
  private _focusFieldPath?: string[];

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

  @state()
  private _savedYaml = "";

  @state()
  private _saving = false;

  @query("esphome-unsaved-changes-dialog")
  private _unsavedDialog!: ESPHomeUnsavedChangesDialog;

  /** Live ref to the mounted section-config component, when one
   *  is rendered. Captured via ``section-mount`` /
   *  ``section-unmount`` events that the component fires on its
   *  own lifecycle hooks; ``@query`` doesn't reach across the
   *  three shadow roots between this page and the section
   *  editor, so the registration pattern keeps the call site
   *  for ``activeSection.save()`` cheap and direct. */
  private _activeSection: ESPHomeDeviceSectionConfig | null = null;

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
    });
  }

  /** Pending unsaved-changes guard. Both the page-leave check
   *  and the section-switch check pipe through this one helper:
   *  the dialog event handlers call into whichever one is
   *  currently set, the unset case is a no-op. Owning the
   *  bookkeeping in a separate class keeps the page lean and
   *  lets the logic be unit-tested in node without happy-dom. */
  private _unsavedGuard = new UnsavedGuard();

  /** When true, the next popstate is allowed to fall through to the router. */
  private _allowingLeave = false;

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
   *  ``_activeSection?.flushPending()`` synchronously before they
   *  read this getter, so by the time ``_isDirty`` is consulted
   *  any pending form edits have been promoted into ``_yaml`` and
   *  the YAML branch is authoritative. */
  private get _isDirty(): boolean {
    return this._isYamlDirty || this._sectionDirty;
  }

  /* ``_allowingLeave`` is flipped BEFORE the guard Promise
   * resolves so the page-leave callers see a coherent state on
   * the next microtask:
   *
   *   - The browser-back path ``.then``s on the resolved
   *     Promise and calls ``history.back()`` itself.
   *   - ``navigate()`` (in-app Back / logo click) on
   *     ``canLeave=true`` does ``pushState + dispatchEvent(popstate)``
   *     synchronously. That synthetic popstate would otherwise
   *     be re-intercepted by ``_onPopState`` (because ``_isDirty``
   *     stays true — Discard doesn't revert the buffer) and
   *     bounced back to the device URL, leaving the user stuck.
   *     Flipping the flag here short-circuits that.
   *
   * The flip happens inside the page-leave save lambda (so it
   * lands synchronously before the guard's resolve when the
   * user picks Save) and again in ``_confirmLeave`` after the
   * await (so it covers the Discard path too — Discard doesn't
   * route through the save lambda). The redundant write on Save
   * is idempotent. The section-switch guard never sets the flag
   * — its ``save`` returns to the page synchronously after the
   * await without leaving the page.
   */
  private _onUnsavedDiscard = () => this._unsavedGuard.onDiscard();
  private _onUnsavedSave = () => this._unsavedGuard.onSave();
  private _onUnsavedCancel = () => this._unsavedGuard.onCancel();

  private _confirmLeave = async (): Promise<boolean> => {
    // Promote any pending form keystrokes into ``_yaml`` before the
    // dialog so the user is shown the canonical "do you want to
    // save?" question. Without this flush, a user who typed in the
    // form and immediately hit back would see the dialog reflect
    // ``_sectionDirty`` (transient) rather than the YAML diff that
    // ``Save`` is going to commit.
    this._activeSection?.flushPending();
    const ok = await this._unsavedGuard.run({
      dirty: this._isDirty,
      open: () => this._unsavedDialog?.open(),
      save: async () => {
        // ``_saveYaml`` may open the validation prompt and await
        // the user's choice. If they pick Cancel or Go to error,
        // it resolves ``false`` and we propagate that up — the
        // user isn't done editing, so the page-leave guard
        // shouldn't proceed with navigation.
        if (this._isYamlDirty) {
          const saved = await this._saveYaml();
          if (!saved) return false;
        }
        this._allowingLeave = true;
        return true;
      },
    });
    if (ok) this._allowingLeave = true;
    return ok;
  };

  private _onBeforeUnload = (e: BeforeUnloadEvent) => {
    // Flush the form's pending debounce so a user who typed in the
    // form and immediately closed the tab gets warned (the form's
    // own keystroke would otherwise sit in the debounce window with
    // no representation in ``_yaml``).
    this._activeSection?.flushPending();
    if (this._isDirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  };

  private _onPopState = (e: PopStateEvent) => {
    if (this._allowingLeave) {
      this._allowingLeave = false;
      return;
    }
    this._activeSection?.flushPending();
    if (!this._isDirty) return;
    e.stopImmediatePropagation();
    window.history.pushState({}, "", withBase(`/device/${this.id}`));
    this._confirmLeave().then((canLeave) => {
      if (canLeave) {
        this._allowingLeave = true;
        window.history.back();
      }
    });
  };

  async connectedCallback() {
    super.connectedCallback();
    this._loadPreferences();
    setLeaveGuard(this._confirmLeave);
    window.addEventListener("beforeunload", this._onBeforeUnload);
    window.addEventListener("popstate", this._onPopState, { capture: true });
    window.addEventListener("keydown", this._onKeydown);
    this._mql.addEventListener("change", this._onMqlChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    setLeaveGuard(null);
    window.removeEventListener("beforeunload", this._onBeforeUnload);
    window.removeEventListener("popstate", this._onPopState, { capture: true });
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
    if (this._isTextEntry(target)) return;
    if (this._drawerOpen) {
      e.preventDefault();
      this._drawerOpen = false;
      return;
    }
    /* Otherwise leave the editor — same path as the back button, so
       the unsaved-changes guard runs via popstate. */
    e.preventDefault();
    window.history.back();
  };

  private _isTextEntry(el: HTMLElement | undefined): boolean {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (el.isContentEditable) return true;
    /* The Monaco-style YAML editor renders its caret inside a
       textarea-like child but the focused element can vary by version.
       Walk up looking for a recognisable editor host. */
    let cur: HTMLElement | null = el;
    while (cur) {
      if (cur.tagName === "ESPHOME-YAML-EDITOR") return true;
      cur = cur.parentElement;
    }
    return false;
  }

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
      this._loadYaml();
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
      this._loadBoard(boardId);
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
   * Swap the device's board to the picked alternate, then reload the YAML
   * pane (`devices/update` rewrote `board:`). The header refreshes itself
   * via the `DEVICE_UPDATED` event.
   */
  private _onChangeBoard = async (e: CustomEvent<{ boardId: string }>) => {
    const boardId = e.detail?.boardId;
    const device = this._device;
    if (!boardId || !device || boardId === device.board_id) return;
    // Reloading YAML after the swap would discard unsaved edits.
    if (this._isDirty) {
      toast.error(this._localize("device.change_board_unsaved"), { richColors: true });
      return;
    }
    try {
      await this._api.updateDevice({
        configuration: device.configuration,
        board_id: boardId,
      });
      await this._loadYaml();
      toast.success(this._localize("device.change_board_success"), { richColors: true });
    } catch (err) {
      console.error("Failed to change board:", err);
      toast.error(this._localize("device.change_board_error"), { richColors: true });
    }
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

  private async _loadYaml() {
    try {
      const yaml = await this._api.getConfig(this.id);
      this._yaml = yaml;
      this._savedYaml = yaml;
      this._maybeResolveLineFromUrl();
    } catch (e) {
      console.error("Failed to load YAML:", e);
    }
  }

  /**
   * Resolve a ``?line=N`` URL parameter to a concrete section
   * once the YAML has loaded.
   *
   * Direct-link arrivals from the dashboard's YAML hit list
   * carry only ``?line=N`` (not ``?section=``); the navigator's
   * highlight + scroll path keys off ``_selectedSection``, so
   * without a section the editor mounts but never scrolls. Walk
   * the just-loaded YAML to find the section that contains line
   * N and pin both ``_selectedSection`` and ``_scrollToHighlight``
   * — the navigator's existing emit-on-update logic then fires
   * the scroll-into-view dispatch in CodeMirror.
   */
  private _maybeResolveLineFromUrl() {
    const resolved = resolveSectionForUrlLine(
      this._yaml,
      this._selectedFromLine,
      this._selectedSection
    );
    if (!resolved) return;
    this._selectedSection = resolved.sectionKey;
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
   * leave"); the page's user-facing Save button doesn't read
   * the return value.
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
          const summary = summarizeValidation(res);
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
    const variant = saved ? toast.success : toast.error;
    variant(this._localize(message), { richColors: true });
    return saved;
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
    const line = e.detail.line;
    if (line && line >= 1) {
      // Sections-only layout would scroll a hidden editor — flip
      // to the split view so the user actually sees where they're
      // landing.
      if (this._layout === "left") {
        // Implicit expand to reveal the error: cache it locally but don't
        // record it as the user's durable layout preference.
        this._cacheLayout("both");
      }
      this._setHighlight({ fromLine: line, toLine: line }, true, true);
      const resolved = resolveSectionForUrlLine(this._yaml, line, null);
      if (resolved) {
        this._selectedSection = resolved.sectionKey;
      }
    }
    // The user wants to fix the error, not leave with it unsaved
    // — resolve as "not saved" so the page-leave guard stays put.
    this._resolveValidationPrompt(false);
  };

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
  // on-disk file, so an unsaved edit would flash the previous version.
  private _installAfterSave = async (run: () => void): Promise<void> => {
    let saved: boolean;
    try {
      saved = await this._saveYaml();
    } catch (e) {
      // _saveYaml rejects when a section editor's flushPending upsert fails;
      // surface it and abort rather than leak an unhandled rejection.
      console.error("Failed to save before install:", e);
      toast.error(this._localize("device.yaml_save_error"), { richColors: true });
      return;
    }
    if (saved) run();
  };
  private _saveThenInstall = () => this._installAfterSave(this._installCtrl.onInstall);
  private _saveThenUpdate = () => this._installAfterSave(this._installCtrl.onUpdate);

  /** Catch ``clean-build`` from the install dialog's post-failure
   *  hint and route it through this page's command-dialog —
   *  mirrors dashboard's page-level handler so the "clean the
   *  build files for this device" link works the same way on
   *  the device page. */
  private _onCleanBuild = (e: CustomEvent<ConfiguredDevice>) => {
    const device = e.detail;
    this._commandDialog.configuration = device.configuration;
    this._commandDialog.name = device.friendly_name || device.name;
    this._commandDialog.open("clean");
  };

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
    navigate(`/device/${encodeURIComponent(e.detail.configuration)}`);
  };

  static styles = [espHomeStyles, devicePageStyles];

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
        ${this._renderNavigator("drawer-nav")}
      </div>

      <div class="page">
        <div
          class="layout-grid ${this._navCollapsed ? "nav-collapsed" : ""}"
          @section-toggle=${this._onSectionToggle}
          @section-reveal=${this._onSectionReveal}
          @layout-change=${this._onLayoutChange}
          @yaml-change=${this._onYamlChange}
          @yaml-diagnostics=${this._onYamlDiagnostics}
          @yaml-cursor-line=${this._onYamlCursorLine}
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
          ${this._renderNavigator("desktop-nav")}
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
            .justCreated=${this._justCreated}
            @just-created-dismiss=${this._dismissJustCreated}
            @change-board=${this._onChangeBoard}
            ?hasUnsavedEdits=${this._isDirty}
            ?saving=${this._saving}
            ?showModified=${this._device ? showPendingChanges(this._device) : false}
            ?showUpdate=${this._device ? showUpdateAvailable(this._device) : false}
            .installedVersion=${this._device?.deployed_version ?? ""}
            .availableVersion=${this._device?.current_version ?? ""}
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
          </esphome-device-editor>
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
        ></esphome-firmware-install-dialog>
        <esphome-logs-dialog></esphome-logs-dialog>
        <esphome-install-method-dialog
          ?open=${this._installCtrl.installMethodOpen}
          .deviceState=${this._installCtrl.deviceState}
          .deviceTargetPlatform=${this._installCtrl.deviceTargetPlatform}
          .deviceCurrentAddress=${this._installCtrl.deviceCurrentAddress}
          .canFlashBootloader=${this._installCtrl.canFlashBootloader}
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
      </div>
    `;
  }

  /** Step one section back along the user's visit trail. With no
   *  trail left we land on the board-info / next-steps view. Leaving
   *  the device entirely is the app-shell's top-left back button —
   *  not this one. */
  private _onBack = () => {
    this._guardSectionSwitch(() => {
      const prev = this._sectionHistory.length
        ? this._sectionHistory[this._sectionHistory.length - 1]
        : null;
      if (prev) {
        this._sectionHistory = this._sectionHistory.slice(0, -1);
        this._selectedSection = prev.key;
        this._selectedFromLine = prev.fromLine;
      } else {
        this._selectedSection = null;
        this._selectedFromLine = undefined;
      }
      this._setHighlight(null, false);
      this._updateUrl();
    });
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
    return html`<esphome-device-navigator
      class=${className}
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
    ></esphome-device-navigator>`;
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
  private _onYamlDiagnostics(
    e: CustomEvent<{ errors: string[]; configuration: string }>
  ) {
    if (e.detail.configuration !== this.id) return;
    if (this._errorHighlight === "edited") {
      this._setHighlight(null, false);
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
  private _onYamlCursorLine(e: CustomEvent<{ line: number; path?: string[] }>) {
    // The user is driving from the YAML pane now — drop any pending
    // form-field retry so it can't re-highlight after they've moved on.
    this._clearPendingFieldLine();
    const full = e.detail.path ?? [];
    // `sectionForCursor` falls back to the caret's key path when no section
    // range covers the line, so the panel follows the caret into a blank,
    // indented child line under a just-typed top-level block.
    const match = sectionForCursor(this._yaml, e.detail.line, full);
    if (!match) return;
    // Drop the top-level key to get the form-relative path. LIST_SECTIONS
    // (globals) are the exception: their form keys fields under the section
    // key, so keep it — but only with a child segment; a bare
    // ``["globals"]`` header reduces to [] (a non-field line), not a
    // whole-section field highlight. MAP sections like substitutions render
    // at an empty path, so their fields are section-relative — slice as usual.
    const rel = full.length > 1 && LIST_SECTIONS.has(full[0]) ? full : full.slice(1);
    const sectionKey = sectionKeyOf(match);
    if (
      sectionKey === this._selectedSection &&
      match.fromLine === this._selectedFromLine
    ) {
      // Same section: update the field target directly for intra-section
      // moves (the switch below would early-return and freeze it).
      this._focusFieldPath = rel;
      return;
    }
    // Cross-section: set the field path only when the switch actually
    // applies, so a guard veto (unsaved edits) can't point the old
    // section's form at a path meant for the new one.
    this._guardSectionSwitch(() => {
      this._selectedSection = sectionKey;
      this._selectedFromLine = match.fromLine;
      this._focusFieldPath = rel;
      this._updateUrl();
    });
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

  /** Single write path for the editor highlight, so the error-jump
   *  flag can't leak into navigation / field-focus highlights. */
  private _setHighlight(range: HighlightRange | null, scroll: boolean, isError = false) {
    this._highlightRange = range;
    this._scrollToHighlight = scroll;
    this._errorHighlight = isError && range !== null ? "active" : "none";
  }

  private _onYamlUpdated(e: CustomEvent<{ yaml: string }>) {
    /* ``yaml-updated`` fires from completed-API-call paths only —
     * the add-component dialog and the section-delete branch.
     * Both ``await`` the API call before dispatching, so by the
     * time we see this event the new YAML is already on disk and
     * ``_savedYaml`` can safely advance to match.
     *
     * Form edits in the section editor flow through the separate
     * ``yaml-draft`` event (see ``_onYamlDraft`` below) which
     * advances only ``_yaml`` — those are committed via the right-
     * pane Save button. */
    this._setYaml(e.detail.yaml);
    this._savedYaml = e.detail.yaml;
  }

  private _onYamlDraft(e: CustomEvent<{ yaml: string }>) {
    /* Form auto-sync: the section editor spliced its current
     * ``_values`` into the YAML and is asking us to surface that
     * in the YAML pane. Only ``_yaml`` advances; ``_savedYaml``
     * stays put so the right-pane Save button activates and the
     * user sees the buffer is dirty. */
    this._setYaml(e.detail.yaml);
    this._retryPendingFieldLine();
  }

  private _onSectionSelect(
    e: CustomEvent<{ sectionKey: string | null; fromLine?: number }>
  ) {
    const { sectionKey, fromLine } = e.detail;
    if (sectionKey === this._selectedSection && fromLine === this._selectedFromLine) {
      this._drawerOpen = false;
      return;
    }
    this._guardSectionSwitch(() => {
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
        this._sectionHistory = [
          ...this._sectionHistory,
          { key: prev, fromLine: prevLine },
        ];
      }
      this._selectedSection = sectionKey;
      this._selectedFromLine = fromLine;
      this._drawerOpen = false;
      this._updateUrl();
    });
  }

  /** Switch sections, flushing any pending form draft first.
   *
   *  No unsaved-changes dialog: with auto-sync, the form's
   *  current ``_values`` are always already in the draft YAML
   *  buffer (or a sync-microtask away). Switching never loses
   *  work — the user's edits stay visible in the YAML pane and
   *  re-render in the form when they come back to this section.
   *  The leave-page guard (``_confirmLeave``) is the only thing
   *  that prompts about unsaved YAML, since *that's* the only
   *  state that's actually at risk. */
  private _guardSectionSwitch(action: () => void): void {
    this._activeSection?.flushPending();
    action();
  }

  private _onSectionMount = (e: Event) => {
    const ev = e as CustomEvent<{ node: ESPHomeDeviceSectionConfig }>;
    this._activeSection = ev.detail.node;
    this._sectionDirty = ev.detail.node.dirty;
  };

  private _onSectionUnmount = (e: Event) => {
    const ev = e as CustomEvent<{ node: ESPHomeDeviceSectionConfig }>;
    if (this._activeSection === ev.detail.node) {
      this._activeSection = null;
      this._sectionDirty = false;
    }
  };

  private _onSectionDirtyChange = (e: Event) => {
    const ev = e as CustomEvent<{ dirty: boolean }>;
    this._sectionDirty = ev.detail.dirty;
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
