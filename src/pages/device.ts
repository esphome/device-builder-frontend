import { consume } from "@lit/context";
import { mdiArrowCollapseLeft, mdiArrowCollapseRight } from "@mdi/js";
import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../api/index.js";
import type { BoardCatalogEntry, ConfiguredDevice, FirmwareJob } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import type { ESPHomeCommandDialog } from "../components/command-dialog.js";
import type { NavSectionName } from "../components/device/device-board-info.js";
import type { DeviceLayoutMode } from "../components/device/device-editor.js";
// `NavSectionName` is consumed by the section-show event handler; the
// page itself doesn't pass it down anymore now that the step CTAs
// always render.
import { DeviceInstallController } from "../components/device/device-install-controller.js";
import type { ESPHomeFirmwareInstallDialog } from "../components/firmware-install-dialog.js";
import type { ESPHomeLogsDialog } from "../components/logs-dialog.js";
import type { ESPHomeUnsavedChangesDialog } from "../components/unsaved-changes-dialog.js";
import type { ESPHomeDeviceSectionConfig } from "../components/device/device-section-config.js";
import type { HighlightRange } from "../components/yaml-editor.js";
import type { ESPHomeYamlValidationDialog } from "../components/yaml-validation-dialog.js";
import {
  activeJobsContext,
  apiContext,
  devicesContext,
  localizeContext,
} from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { withBase } from "../util/base-path.js";
import { consumeJustCreated } from "../util/just-created.js";
import { navigate, setLeaveGuard } from "../util/navigation.js";
import { postInstallShowLogsHandler } from "../util/post-install-logs.js";
import { UnsavedGuard } from "../util/unsaved-guard.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { sectionAtLine, sectionKeyOf } from "../util/yaml-sections.js";
import { resolveSectionForUrlLine } from "../util/url-line-resolver.js";
import { summarizeValidation } from "../util/yaml-validation-summary.js";
import { devicePageStyles } from "./device-styles.js";

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
  "arrow-collapse-left": mdiArrowCollapseLeft,
  "arrow-collapse-right": mdiArrowCollapseRight,
});

@customElement("esphome-page-device")
export class ESPHomePageDevice extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

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

  /** Last `board_id` we kicked off a fetch for. Used to dedupe so a
   *  re-render doesn't refetch the same board, and to detect board
   *  changes (rename / wizard re-run) and refetch when needed. */
  private _loadedBoardId: string | null = null;

  @state()
  private _highlightRange: HighlightRange | null = null;

  @state()
  private _scrollToHighlight = false;

  @state()
  private _selectedSection: string | null = this._readUrlParam("section", null);

  @state()
  private _selectedFromLine?: number = this._readUrlLine();

  @state()
  private _drawerOpen = false;

  @state()
  private _navCollapsed = false;

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

  private _onPostInstallShowLogs = postInstallShowLogsHandler(
    () => this._logsDialog,
    () => this._localize,
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
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    setLeaveGuard(null);
    window.removeEventListener("beforeunload", this._onBeforeUnload);
    window.removeEventListener("popstate", this._onPopState, { capture: true });
    window.removeEventListener("keydown", this._onKeydown);
    // Drop any in-flight unsaved-changes guard so its caller's
    // ``await`` doesn't dangle past unmount — resolve as "don't
    // proceed" since the page is going away anyway.
    this._unsavedGuard.cancelPending();
  }

  private _onKeydown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    /* If a deeper component (the fullscreen YAML editor, an open
       dialog, etc.) already handled this Esc, don't also navigate
       back. Mirrors the EscapeController guard so the leave-page
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
      this._loadYaml();
    }
    // Devices context arrives async after connect; kick off the board
    // fetch as soon as we have a `board_id` (and re-fetch only when it
    // actually changes).
    const boardId = this._device?.board_id ?? null;
    if (boardId && boardId !== this._loadedBoardId) {
      this._loadedBoardId = boardId;
      this._loadBoard(boardId);
    } else if (!boardId && this._loadedBoardId !== null && this._board) {
      // Device dropped its board_id (rare — wizard re-run cleared it).
      this._loadedBoardId = null;
      this._board = null;
    }
  }

  /** Lets the user dismiss the welcome banner without leaving the page. */
  private _dismissJustCreated = () => {
    this._justCreated = false;
  };

  private async _loadPreferences() {
    // Editor layout stored locally (not in backend preferences)
    const savedLayout = localStorage.getItem("esphome-editor-layout");
    if (savedLayout === "both" || savedLayout === "left" || savedLayout === "right") {
      this._layout = savedLayout;
    }

    try {
      const prefs = await this._api.getPreferences();
      this._navCollapsed = !prefs.navigator_visible;
    } catch {
      // Preferences not critical — use defaults
    }
  }

  private async _loadBoard(boardId: string) {
    try {
      // Single-board lookup keyed off the BE-resolved `board_id` —
      // avoids paging the full catalog when we only ever consume one
      // board on the device editor. The BE handles deriving board_id
      // from YAML on its side (see `_resolve_board_id`), so we don't
      // need a YAML-regex fallback here.
      const board = await this._api.getBoard(boardId);
      // Guard against late responses overwriting a newer fetch — if
      // the user navigated to another device while this was in flight,
      // `_loadedBoardId` will already point at the new id.
      if (this._loadedBoardId === boardId) {
        this._board = board;
      }
    } catch (e) {
      console.error("Failed to load board:", e);
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
    this._highlightRange = resolved.range;
    this._scrollToHighlight = true;
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
    // Promote any in-flight form keystroke (still inside its 200ms
    // debounce window) into ``_yaml`` so the save commits exactly
    // what the user typed — not what was last flushed.
    this._activeSection?.flushPending();
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
        const res = await this._api.validateYaml(this.id, this._yaml);
        const summary = summarizeValidation(res);
        if (summary.count > 0) {
          this._validationErrorCount = summary.count;
          this._validationFirstLine = summary.first?.line ?? 0;
          this._validationFirstCol = summary.first?.col ?? 0;
          this._validationFirstMessage = summary.first?.message ?? "";
          // A previous prompt that's somehow still pending (the
          // unsaved-guard already prevents overlapping page-leave
          // dialogs, but a manual Save click reaches this branch
          // unguarded) gets resolved as "not saved" before we
          // reset the resolver — without this the prior caller
          // would dangle forever.
          this._pendingValidationResolve?.(false);
          return new Promise<boolean>((resolve) => {
            this._pendingValidationResolve = resolve;
            this._yamlValidationDialog.open();
          });
        }
      } catch (e) {
        console.debug("[save-yaml] validate_yaml failed, saving anyway:", e);
      }
    }

    return this._doSaveYaml();
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
  private _onValidationGoTo = (
    e: CustomEvent<{ line: number; col: number }>,
  ) => {
    const line = e.detail.line;
    if (line && line >= 1) {
      // Sections-only layout would scroll a hidden editor — flip
      // to the split view so the user actually sees where they're
      // landing.
      if (this._layout === "left") {
        this._layout = "both";
        localStorage.setItem("esphome-editor-layout", "both");
      }
      this._highlightRange = { fromLine: line, toLine: line };
      this._scrollToHighlight = true;
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
    this._commandDialog.name =
      this._device.friendly_name || this._device.name;
    this._commandDialog.open("validate");
  };

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
  private _onRequestOpenEditor = (
    e: CustomEvent<{ configuration: string }>
  ) => {
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
        @section-select=${this._onSectionSelect}
        @yaml-highlight=${this._onYamlHighlight}
      >
        ${this._renderNavigator("drawer-nav")}
      </div>

      <div class="page">
        <div
          class="layout-grid ${this._navCollapsed ? "nav-collapsed" : ""}"
          @section-toggle=${this._onSectionToggle}
          @layout-change=${this._onLayoutChange}
          @yaml-change=${this._onYamlChange}
          @yaml-cursor-line=${this._onYamlCursorLine}
          @yaml-highlight=${this._onYamlHighlight}
          @yaml-updated=${this._onYamlUpdated}
          @yaml-draft=${this._onYamlDraft}
          @section-select=${this._onSectionSelect}
          @section-mount=${this._onSectionMount}
          @section-unmount=${this._onSectionUnmount}
          @dirty-change=${this._onSectionDirtyChange}
          @nav-section-show=${this._onNavSectionShow}
          @save-yaml=${this._saveYaml}
          @validate-device=${this._onValidateClick}
          @install-device=${this._installCtrl.onInstall}
          @update-device=${this._installCtrl.onUpdate}
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
            .justCreated=${this._justCreated}
            @just-created-dismiss=${this._dismissJustCreated}
            ?hasUnsavedEdits=${this._isDirty}
            ?hasPendingChanges=${this._device?.has_pending_changes === true}
            ?hasUpdateAvailable=${this._device?.update_available === true}
            ?busy=${this._activeJobs.has(this.id)}
          >
            <button slot="mobile-menu" class="nav-toggle-btn" @click=${this._onNavToggle}>
              <wa-icon library="mdi" name=${this._navToggleIcon}></wa-icon>
            </button>
          </esphome-device-editor>
        </div>
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
        @close=${this._installCtrl.onInstallMethodClose}
        @select-method=${this._installCtrl.onInstallMethodSelect}
      ></esphome-install-method-dialog>
      <esphome-yaml-validation-dialog
        .errorCount=${this._validationErrorCount}
        .firstErrorLine=${this._validationFirstLine}
        .firstErrorCol=${this._validationFirstCol}
        .firstErrorMessage=${this._validationFirstMessage}
        @save-anyway=${this._onValidationSaveAnyway}
        @goto=${this._onValidationGoTo}
        @cancel=${this._onValidationCancel}
      ></esphome-yaml-validation-dialog>
    `;
  }

  private get _isMobile(): boolean {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  private get _navToggleIcon(): string {
    if (this._isMobile) {
      return "arrow-collapse-right";
    }
    return this._navCollapsed ? "arrow-collapse-right" : "arrow-collapse-left";
  }

  private _onNavToggle() {
    if (this._isMobile) {
      this._drawerOpen = !this._drawerOpen;
    } else {
      this._navCollapsed = !this._navCollapsed;
      this._api
        .updatePreferences({ navigator_visible: !this._navCollapsed })
        .catch(() => {});
    }
  }

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
    this._layout = e.detail;
    localStorage.setItem("esphome-editor-layout", e.detail);
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
      .platform=${this._board?.esphome.platform ?? ""}
      .selectedKey=${this._selectedSection}
      .selectedFromLine=${this._selectedFromLine}
    ></esphome-device-navigator>`;
  }

  private _onYamlChange(e: CustomEvent<{ value: string }>) {
    this._yaml = e.detail.value;
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
  private _onYamlCursorLine(e: CustomEvent<{ line: number }>) {
    const match = sectionAtLine(this._yaml, e.detail.line);
    if (!match) return;
    const sectionKey = sectionKeyOf(match);
    if (
      sectionKey === this._selectedSection &&
      match.fromLine === this._selectedFromLine
    ) {
      return;
    }
    this._guardSectionSwitch(() => {
      this._selectedSection = sectionKey;
      this._selectedFromLine = match.fromLine;
      this._updateUrl();
    });
  }

  private _onYamlHighlight(
    e: CustomEvent<{ range: HighlightRange | null; scroll: boolean }>
  ) {
    this._highlightRange = e.detail.range;
    this._scrollToHighlight = e.detail.scroll;
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
    this._yaml = e.detail.yaml;
    this._savedYaml = e.detail.yaml;
  }

  private _onYamlDraft(e: CustomEvent<{ yaml: string }>) {
    /* Form auto-sync: the section editor spliced its current
     * ``_values`` into the YAML and is asking us to surface that
     * in the YAML pane. Only ``_yaml`` advances; ``_savedYaml``
     * stays put so the right-pane Save button activates and the
     * user sees the buffer is dirty. */
    this._yaml = e.detail.yaml;
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
    const params = new URLSearchParams(window.location.search);
    return params.get(key) ?? fallback;
  }

  private _readUrlLine(): number | undefined {
    const raw = new URLSearchParams(window.location.search).get("line");
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isNaN(n) ? undefined : n;
  }

  private _readUrlSections(): number[] {
    const raw = new URLSearchParams(window.location.search).get("open");
    if (!raw) return [];
    return raw
      .split(",")
      .map(Number)
      .filter((n) => !Number.isNaN(n));
  }

  private _updateUrl() {
    const params = new URLSearchParams(window.location.search);

    // Selected section + line
    if (this._selectedSection) {
      params.set("section", this._selectedSection);
      if (this._selectedFromLine !== undefined) {
        params.set("line", String(this._selectedFromLine));
      } else {
        params.delete("line");
      }
    } else {
      params.delete("section");
      params.delete("line");
    }

    // Open navigator sections
    if (this._openSections.size > 0) {
      params.set("open", [...this._openSections].join(","));
    } else {
      params.delete("open");
    }

    const qs = params.toString();
    const newUrl = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    window.history.replaceState(null, "", newUrl);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-page-device": ESPHomePageDevice;
  }
}
