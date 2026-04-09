import { consume } from "@lit/context";
import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { BoardCatalogEntry, ConfiguredDevice } from "../api/types.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { LocalizeFunc } from "../common/localize.js";
import type { DeviceLayoutMode } from "../components/device/device-editor.js";
import type { HighlightRange } from "../components/yaml-editor.js";
import toast from "sonner-js";
import { localizeContext, devicesContext, apiContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";

import "../components/device/device-editor.js";
import "../components/device/device-navigator.js";

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
  private _selectedFromLine?: number;

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

  private async _saveYaml() {
    try {
      await this._api.updateConfig(this.id, this._yaml);
      toast.success(this._localize("device.yaml_saved"), { richColors: true });
    } catch (e) {
      console.error("Failed to save YAML:", e);
      toast.error(this._localize("device.yaml_save_error"), { richColors: true });
    }
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

      @media (max-width: 900px) {
        .layout-grid {
          grid-template-columns: 1fr;
          height: auto;
        }
      }
    `,
  ];

  protected render() {
    const deviceTitle =
      this._device?.friendly_name || this._device?.name || this.id || this._localize("dashboard.create_device");

    return html`
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
            .openSections=${this._openSections}
            .yaml=${this._yaml}
            .boardName=${this._board?.name ?? ""}
            .configuration=${this.id}
            .selectedKey=${this._selectedSection}
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
          ></esphome-device-editor>
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
    this._updateUrl();
  }

  // ─── URL State Persistence ─────────────────────────────────

  private _readUrlParam(key: string, fallback: string): string;
  private _readUrlParam(key: string, fallback: null): string | null;
  private _readUrlParam(key: string, fallback: string | null): string | null {
    const params = new URLSearchParams(window.location.search);
    return params.get(key) ?? fallback;
  }

  private _readUrlSections(): number[] {
    const raw = new URLSearchParams(window.location.search).get("open");
    if (!raw) return [];
    return raw.split(",").map(Number).filter((n) => !Number.isNaN(n));
  }

  private _updateUrl() {
    const params = new URLSearchParams(window.location.search);

    // Selected section
    if (this._selectedSection) {
      params.set("section", this._selectedSection);
    } else {
      params.delete("section");
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
