import { consume } from "@lit/context";
import { mdiArrowCollapseLeft, mdiArrowCollapseRight } from "@mdi/js";
import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../api/index.js";
import type {
  BoardCatalogEntry,
  ConfiguredDevice,
  FirmwareJob,
} from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import type { ESPHomeCommandDialog } from "../components/command-dialog.js";
import type { NavSectionName } from "../components/device/device-board-info.js";
import type { DeviceLayoutMode } from "../components/device/device-editor.js";
// `NavSectionName` is consumed by the section-show event handler; the
// page itself doesn't pass it down anymore now that the step CTAs
// always render.
import { DeviceInstallController } from "../components/device/device-install-controller.js";
import type { ESPHomeFirmwareInstallDialog } from "../components/firmware-install-dialog.js";
import type { ESPHomeUnsavedChangesDialog } from "../components/unsaved-changes-dialog.js";
import type { HighlightRange } from "../components/yaml-editor.js";
import {
  activeJobsContext,
  apiContext,
  devicesContext,
  localizeContext,
} from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { consumeJustCreated } from "../util/just-created.js";
import { setLeaveGuard } from "../util/navigation.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { sectionAtLine, sectionKeyOf } from "../util/yaml-sections.js";
import { devicePageStyles } from "./device-styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../components/command-dialog.js";
import "../components/device/device-editor.js";
import "../components/device/device-navigator.js";
import "../components/firmware-install-dialog.js";
import "../components/install-method-dialog.js";
import "../components/unsaved-changes-dialog.js";

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
  private _leaveDialog!: ESPHomeUnsavedChangesDialog;

  @query("esphome-command-dialog")
  private _commandDialog!: ESPHomeCommandDialog;

  @query("esphome-firmware-install-dialog")
  private _firmwareDialog!: ESPHomeFirmwareInstallDialog;

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

  private _pendingLeaveResolve: ((value: boolean) => void) | null = null;

  /** When true, the next popstate is allowed to fall through to the router. */
  private _allowingLeave = false;

  private get _isDirty(): boolean {
    return this._yaml !== this._savedYaml;
  }

  private _confirmLeave = (): Promise<boolean> => {
    if (!this._isDirty) return Promise.resolve(true);
    if (this._pendingLeaveResolve) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      this._pendingLeaveResolve = resolve;
      this._leaveDialog?.open();
    });
  };

  private _resolvePendingLeave(value: boolean) {
    const r = this._pendingLeaveResolve;
    this._pendingLeaveResolve = null;
    r?.(value);
  }

  /* Discard / Save flip ``_allowingLeave`` BEFORE resolving the
   * guard Promise. Two callers wait on that resolve:
   *   - The browser-back path, which then calls ``history.back()``
   *     itself (the popstate handler's ``.then`` would set
   *     ``_allowingLeave`` afterwards).
   *   - ``navigate()`` (in-app Back / logo click), which on
   *     ``canLeave=true`` does ``pushState + dispatchEvent(popstate)``
   *     synchronously. That synthetic popstate would otherwise be
   *     re-intercepted by ``_onPopState`` (because ``_isDirty`` is
   *     still true here — Discard doesn't revert the buffer) and
   *     bounced back to the device URL, leaving the user stuck on
   *     the page they were trying to leave. Setting the flag here
   *     short-circuits the next popstate so navigate's URL push
   *     actually sticks.
   */
  private _onLeaveDiscard = () => {
    this._allowingLeave = true;
    this._resolvePendingLeave(true);
  };

  private _onLeaveSave = () => {
    this._saveYaml();
    this._allowingLeave = true;
    this._resolvePendingLeave(true);
  };

  private _onLeaveCancel = () => this._resolvePendingLeave(false);

  private _onBeforeUnload = (e: BeforeUnloadEvent) => {
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
    if (!this._isDirty) return;
    e.stopImmediatePropagation();
    window.history.pushState({}, "", `/device/${this.id}`);
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
    this._resolvePendingLeave(false);
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
    } catch (e) {
      console.error("Failed to load YAML:", e);
    }
  }

  private _saveYaml() {
    this._savedYaml = this._yaml;
    toast.success(this._localize("device.yaml_saved"), { richColors: true });
    this._api.updateConfig(this.id, this._yaml).catch((e) => {
      // Only surface real errors, not command timeouts — the backend
      // writes the file but may not send a response before the timeout.
      const msg = e instanceof Error ? e.message : "";
      if (!msg.includes("timed out")) {
        console.error("Failed to save YAML:", e);
        toast.error(this._localize("device.yaml_save_error"), { richColors: true });
      }
    });
  }

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
          @section-select=${this._onSectionSelect}
          @nav-section-show=${this._onNavSectionShow}
          @save-yaml=${this._saveYaml}
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
        @discard=${this._onLeaveDiscard}
        @save=${this._onLeaveSave}
        @cancel=${this._onLeaveCancel}
      ></esphome-unsaved-changes-dialog>
      <esphome-command-dialog></esphome-command-dialog>
      <esphome-firmware-install-dialog></esphome-firmware-install-dialog>
      <esphome-install-method-dialog
        ?open=${this._installCtrl.installMethodOpen}
        .deviceState=${this._installCtrl.deviceState}
        .deviceTargetPlatform=${this._installCtrl.deviceTargetPlatform}
        .deviceCurrentAddress=${this._installCtrl.deviceCurrentAddress}
        @close=${this._installCtrl.onInstallMethodClose}
        @select-method=${this._installCtrl.onInstallMethodSelect}
      ></esphome-install-method-dialog>
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
      this._api.updatePreferences({ navigator_visible: !this._navCollapsed }).catch(() => {});
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
  private _onNavSectionShow(
    e: CustomEvent<{ section: NavSectionName }>,
  ) {
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
      this._api
        .updatePreferences({ navigator_visible: true })
        .catch(() => {});
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
    this._selectedSection = sectionKey;
    this._selectedFromLine = match.fromLine;
    this._updateUrl();
  }

  private _onYamlHighlight(
    e: CustomEvent<{ range: HighlightRange | null; scroll: boolean }>
  ) {
    this._highlightRange = e.detail.range;
    this._scrollToHighlight = e.detail.scroll;
  }

  private _onYamlUpdated(e: CustomEvent<{ yaml: string }>) {
    /* ``yaml-updated`` fires from the visual-editor section save,
     * the add-component dialog, and the section-delete path. Two
     * emitters (``add-component-dialog`` and the section-delete
     * branch) ``await`` the API call before dispatching; the
     * section-save path is intentionally optimistic — it kicks
     * off ``api.updateConfig`` without awaiting and dispatches
     * immediately so the form clears its dirty state without an
     * extra round-trip. ``_savedYaml`` advances optimistically to
     * match: it tracks "what we believe is on disk", consistent
     * with the section component's own optimistic ``_dirty=false``.
     * If the save fails, the section's existing error toast
     * surfaces it; the parent's dirty state is the rare wrong
     * follower of the optimistic flow.
     *
     * Without this, the YAML editor's Save button stayed enabled
     * after a successful visual save because ``_isDirty`` (which
     * compares ``_yaml`` vs ``_savedYaml``) latched true on the
     * first ``yaml-updated``. */
    this._yaml = e.detail.yaml;
    this._savedYaml = e.detail.yaml;
  }

  private _onSectionSelect(
    e: CustomEvent<{ sectionKey: string | null; fromLine?: number }>
  ) {
    this._selectedSection = e.detail.sectionKey;
    this._selectedFromLine = e.detail.fromLine;
    this._drawerOpen = false;
    this._updateUrl();
  }

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
