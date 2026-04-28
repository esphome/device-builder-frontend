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
import type { DeviceLayoutMode } from "../components/device/device-editor.js";
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
import { setLeaveGuard } from "../util/navigation.js";
import { registerMdiIcons } from "../util/register-icons.js";
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

  @property({ type: Boolean })
  justCreated = false;

  @state()
  private _layout: DeviceLayoutMode = "both";

  @state()
  private _openSections = new Set<number>(this._readUrlSections());

  private get _device(): ConfiguredDevice | null {
    return this._devices.find((d) => d.configuration === this.id) ?? null;
  }

  @state()
  private _boards: BoardCatalogEntry[] = [];

  private get _board(): BoardCatalogEntry | null {
    // Prefer explicit board_id from metadata
    const boardId = this._device?.board_id;
    if (boardId) return this._boards.find((b) => b.id === boardId) ?? null;
    // Fallback: extract `board:` value from the YAML and match by hardware board ID
    const match = this._yaml.match(/^\s{2}board:\s*(\S+)/m);
    if (match) return this._boards.find((b) => b.esphome.board === match[1]) ?? null;
    return null;
  }

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

  private _onLeaveDiscard = () => this._resolvePendingLeave(true);

  private _onLeaveSave = () => {
    this._saveYaml();
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
    this._loadBoardCatalog();
    this._loadPreferences();
    setLeaveGuard(this._confirmLeave);
    window.addEventListener("beforeunload", this._onBeforeUnload);
    window.addEventListener("popstate", this._onPopState, { capture: true });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    setLeaveGuard(null);
    window.removeEventListener("beforeunload", this._onBeforeUnload);
    window.removeEventListener("popstate", this._onPopState, { capture: true });
    this._resolvePendingLeave(false);
  }

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("id") && this.id) {
      this._loadYaml();
    }
  }

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

  private async _loadBoardCatalog() {
    try {
      // Load a reasonable set of boards for matching the current device's board
      const response = await this._api.getBoards({ limit: 200 });
      this._boards = response.boards;
    } catch (e) {
      console.error("Failed to load board catalog:", e);
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
        <esphome-device-navigator
          class="drawer-nav"
          .openSections=${this._openSections}
          .yaml=${this._yaml}
          .boardName=${this._board?.name ?? ""}
          .configuration=${this.id}
          .selectedKey=${this._selectedSection}
          .selectedFromLine=${this._selectedFromLine}
        ></esphome-device-navigator>
      </div>

      <div class="page">
        <div
          class="layout-grid ${this._navCollapsed ? "nav-collapsed" : ""}"
          @section-toggle=${this._onSectionToggle}
          @layout-change=${this._onLayoutChange}
          @yaml-change=${this._onYamlChange}
          @yaml-highlight=${this._onYamlHighlight}
          @yaml-updated=${this._onYamlUpdated}
          @section-select=${this._onSectionSelect}
          @save-yaml=${this._saveYaml}
          @install-device=${this._installCtrl.onInstall}
          @update-device=${this._installCtrl.onUpdate}
        >
          <esphome-device-navigator
            class="desktop-nav"
            .openSections=${this._openSections}
            .yaml=${this._yaml}
            .boardName=${this._board?.name ?? ""}
            .configuration=${this.id}
            .selectedKey=${this._selectedSection}
            .selectedFromLine=${this._selectedFromLine}
          ></esphome-device-navigator>
          <esphome-device-editor
            .yaml=${this._yaml}
            .savedYaml=${this._savedYaml}
            .layout=${this._layout}
            .deviceTitle=${deviceTitle}
            .board=${this._board}
            .justCreated=${this.justCreated}
            .highlightRange=${this._highlightRange}
            .scrollToHighlight=${this._scrollToHighlight}
            .configuration=${this.id}
            .selectedSection=${this._selectedSection}
            .selectedFromLine=${this._selectedFromLine}
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

  private _onSectionToggle(e: CustomEvent<{ index: number }>) {
    const next = new Set(this._openSections);
    if (next.has(e.detail.index)) {
      next.delete(e.detail.index);
    } else {
      next.add(e.detail.index);
    }
    this._openSections = next;
    this._updateUrl();
  }

  private _onLayoutChange(e: CustomEvent<DeviceLayoutMode>) {
    this._layout = e.detail;
    localStorage.setItem("esphome-editor-layout", e.detail);
  }

  private _onYamlChange(e: CustomEvent<{ value: string }>) {
    this._yaml = e.detail.value;
  }

  private _onYamlHighlight(
    e: CustomEvent<{ range: HighlightRange | null; scroll: boolean }>
  ) {
    this._highlightRange = e.detail.range;
    this._scrollToHighlight = e.detail.scroll;
  }

  private _onYamlUpdated(e: CustomEvent<{ yaml: string }>) {
    this._yaml = e.detail.yaml;
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
