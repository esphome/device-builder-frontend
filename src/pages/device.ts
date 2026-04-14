import { consume } from "@lit/context";
import { mdiMenu } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { registerMdiIcons } from "../util/register-icons.js";
import type { BoardCatalogEntry, ConfiguredDevice } from "../api/types.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { LocalizeFunc } from "../common/localize.js";
import type { DeviceLayoutMode } from "../components/device/device-editor.js";
import type { HighlightRange } from "../components/yaml-editor.js";
import toast from "sonner-js";
import { localizeContext, devicesContext, apiContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../components/device/device-editor.js";
import "../components/device/device-navigator.js";

registerMdiIcons({ menu: mdiMenu });

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
  private _yaml = "";

  async connectedCallback() {
    super.connectedCallback();
    this._loadBoardCatalog();
    this._loadPreferences();
  }

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("id") && this.id) {
      this._loadYaml();
    }
  }

  private async _loadPreferences() {
    try {
      const prefs = await this._api.getPreferences();
      if (prefs.editor_layout) {
        this._layout = prefs.editor_layout;
      }
    } catch (e) {
      // Preferences not critical — use default
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
      this._yaml = await this._api.getConfig(this.id);
    } catch (e) {
      console.error("Failed to load YAML:", e);
    }
  }

  private _saveYaml() {
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

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
      }

      .page {
        box-sizing: border-box;
        padding: var(--wa-space-l);
        min-height: calc(100vh - var(--esphome-header-height));
      }

      .layout-grid {
        display: grid;
        grid-template-columns: minmax(230px, 1fr) minmax(0, 5fr);
        gap: var(--wa-space-l);
        height: calc(100vh - var(--esphome-header-height) - 2 * var(--wa-space-l));
      }

      /* ─── Desktop: hide drawer, show sidebar nav ─── */

      .drawer,
      .drawer-backdrop {
        display: none;
      }

      .mobile-menu-btn {
        display: none;
      }

      /* ─── Mobile ─── */

      @media (max-width: 900px) {
        .layout-grid {
          grid-template-columns: 1fr;
          height: calc(100vh - var(--esphome-header-height) - 2 * var(--wa-space-l));
        }

        /* Hide the desktop sidebar */
        .desktop-nav {
          display: none !important;
        }

        /* Show the mobile menu button */
        .mobile-menu-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: none;
          background: color-mix(in srgb, var(--esphome-on-primary), transparent 80%);
          color: var(--esphome-on-primary);
          cursor: pointer;
          padding: 4px;
          border-radius: var(--wa-border-radius-m);
          margin-right: var(--wa-space-xs);
        }

        .mobile-menu-btn wa-icon { font-size: 18px; }
        .mobile-menu-btn:hover { background: color-mix(in srgb, var(--esphome-on-primary), transparent 70%); }

        /* Drawer backdrop */
        .drawer-backdrop {
          display: none;
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.4);
          z-index: 99;
        }

        .drawer-backdrop--open {
          display: block;
        }

        /* Drawer panel */
        .drawer {
          display: block;
          position: fixed;
          top: 0;
          left: 0;
          bottom: 0;
          width: 300px;
          max-width: 85vw;
          z-index: 100;
          background: var(--wa-color-surface-default);
          box-shadow: var(--wa-shadow-l);
          overflow-y: auto;
          transform: translateX(-100%);
          transition: transform 0.25s ease;
        }

        .drawer--open {
          transform: translateX(0);
        }

        /* Remove card radius and border inside drawer */
        .drawer {
          --navigator-border-radius: 0;
          --navigator-border: none;
        }
      }
    `,
  ];

  protected render() {
    const deviceTitle =
      this._device?.friendly_name || this._device?.name || this.id || this._localize("dashboard.create_device");

    return html`
      <!-- Mobile drawer -->
      <div
        class="drawer-backdrop ${this._drawerOpen ? "drawer-backdrop--open" : ""}"
        @click=${() => { this._drawerOpen = false; }}
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
          class="layout-grid"
          @section-toggle=${this._onSectionToggle}
          @layout-change=${this._onLayoutChange}
          @yaml-change=${this._onYamlChange}
          @yaml-highlight=${this._onYamlHighlight}
          @yaml-updated=${this._onYamlUpdated}
          @section-select=${this._onSectionSelect}
          @save-yaml=${this._saveYaml}
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
            .layout=${this._layout}
            .deviceTitle=${deviceTitle}
            .board=${this._board}
            .justCreated=${this.justCreated}
            .highlightRange=${this._highlightRange}
            .scrollToHighlight=${this._scrollToHighlight}
            .configuration=${this.id}
            .selectedSection=${this._selectedSection}
            .selectedFromLine=${this._selectedFromLine}
          >
            <button
              slot="mobile-menu"
              class="mobile-menu-btn"
              @click=${() => { this._drawerOpen = true; }}
            >
              <wa-icon library="mdi" name="menu"></wa-icon>
            </button>
          </esphome-device-editor>
        </div>
      </div>
    `;
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
    this._api.updatePreferences({ editor_layout: e.detail }).catch(() => {});
  }

  private _onYamlChange(e: CustomEvent<{ value: string }>) {
    this._yaml = e.detail.value;
  }

  private _onYamlHighlight(e: CustomEvent<{ range: HighlightRange | null; scroll: boolean }>) {
    this._highlightRange = e.detail.range;
    this._scrollToHighlight = e.detail.scroll;
  }

  private _onYamlUpdated(e: CustomEvent<{ yaml: string }>) {
    this._yaml = e.detail.yaml;
  }

  private _onSectionSelect(e: CustomEvent<{ sectionKey: string | null; fromLine?: number }>) {
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
    return raw.split(",").map(Number).filter((n) => !Number.isNaN(n));
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
