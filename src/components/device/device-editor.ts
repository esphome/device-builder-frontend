import { consume } from "@lit/context";
import { mdiContentSave, mdiDockLeft, mdiDockRight, mdiViewSplitHorizontal } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import type { BoardCatalogEntry } from "../../api/types.js";
import type { HighlightRange } from "../yaml-editor.js";
import {
  categorizeSections,
  parseYamlAutomations,
  parseYamlTopLevelSections,
} from "../../util/yaml-sections.js";

import "@home-assistant/webawesome/dist/components/button/button.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../yaml-editor.js";
import "./device-board-info.js";

registerMdiIcons({
  "content-save": mdiContentSave,
  "layout-left": mdiDockLeft,
  "layout-right": mdiDockRight,
  "layout-split": mdiViewSplitHorizontal,
});

export type DeviceLayoutMode = "both" | "left" | "right";

@customElement("esphome-device-editor")
export class ESPHomeDeviceEditor extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property()
  yaml = "";

  @property()
  layout: DeviceLayoutMode = "both";

  @property()
  deviceTitle = "";

  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @property({ type: Boolean })
  justCreated = false;

  @state()
  private _isMobile = false;

  private _mql = window.matchMedia("(max-width: 900px)");

  private _onMqlChange = (e: MediaQueryListEvent) => {
    this._isMobile = e.matches;
  };

  connectedCallback() {
    super.connectedCallback();
    this._isMobile = this._mql.matches;
    this._mql.addEventListener("change", this._onMqlChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._mql.removeEventListener("change", this._onMqlChange);
  }

  @property({ attribute: false })
  highlightRange: HighlightRange | null = null;

  @property({ type: Boolean })
  scrollToHighlight = false;

  @property()
  configuration = "";

  @property({ attribute: false })
  selectedSection: string | null = null;

  @property({ type: Number })
  selectedFromLine?: number;

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: contents;
      }

      .card {
        background: var(--wa-color-surface-default);
        border-radius: var(--wa-border-radius-l);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        box-shadow: var(--wa-elevation-02);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--wa-space-s) var(--wa-space-m);
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .editor-header-main {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        flex: 1;
      }

      .editor-header-title {
        margin: 0;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        margin-right: var(--wa-space-s);
      }

      .save-button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: none;
        background: color-mix(in srgb, var(--esphome-on-primary), transparent 80%);
        color: var(--esphome-on-primary);
        padding: 4px 10px;
        border-radius: 4px;
        cursor: pointer;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
      }

      .save-button:hover {
        background: color-mix(in srgb, var(--esphome-on-primary), transparent 70%);
      }

      .save-button wa-icon {
        font-size: 16px;
      }

      .layout-toggle {
        display: inline-flex;
        align-items: center;
        gap: 2px;
      }

      .layout-toggle button {
        border: none;
        background: transparent;
        color: var(--esphome-on-primary);
        padding: 2px 4px;
        border-radius: 4px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .layout-toggle button[aria-pressed="true"] {
        background: color-mix(in srgb, var(--esphome-on-primary), transparent 85%);
      }

      .layout-toggle button:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }

      .layout-toggle wa-icon {
        font-size: 18px;
      }

      .card-body {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .editor-layout {
        flex: 1;
        min-height: 0;
        display: grid;
        gap: 0;
      }

      .editor-layout--both {
        grid-template-columns: 1fr 1px 1fr;
      }

      .editor-layout--left {
        grid-template-columns: 1fr;
      }

      .editor-layout--right {
        grid-template-columns: 1fr;
      }

      .editor-pane {
        padding: var(--wa-space-m);
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s);
        min-height: 0;
        overflow: hidden;
      }

      .editor-pane--left {
        overflow-y: auto;
      }

      .editor-pane-title {
        margin: 0;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      .editor-pane-body {
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .pane-divider {
        background: var(--wa-color-surface-border);
        width: 1px;
        align-self: stretch;
      }

      .editor-layout--left .editor-pane--right,
      .editor-layout--right .editor-pane--left {
        display: none;
      }

      @media (max-width: 900px) {
        .layout-toggle .split-btn {
          display: none;
        }
      }
    `,
  ];

  protected render() {
    const hasBoard = !!this.board;
    const effectiveLayout = !hasBoard
      ? "right"
      : this._isMobile && this.layout === "both"
        ? "right"
        : this.layout;
    const layoutClass =
      effectiveLayout === "both"
        ? "editor-layout--both"
        : effectiveLayout === "left"
          ? "editor-layout--left"
          : "editor-layout--right";

    const { components } = categorizeSections(parseYamlTopLevelSections(this.yaml));
    const automations = parseYamlAutomations(this.yaml);
    const hasComponents = components.length > 0;
    const hasAutomations = automations.length > 0;

    const title = !hasComponents
      ? this._localize("device.editor_title_no_components", { name: this.deviceTitle })
      : !hasAutomations
        ? this._localize("device.editor_title_no_automations", { name: this.deviceTitle })
        : this._localize("device.editor_title_ready", { name: this.deviceTitle });

    return html`
      <section class="card">
        <header class="card-header">
          <slot name="mobile-menu"></slot>
          <div class="editor-header-main">
            <h2 class="editor-header-title">${title}</h2>
          </div>
          <div class="header-actions">
            <button
              type="button"
              class="save-button"
              @click=${this._onSave}
              title=${this._localize("device.save_yaml")}
            >
              <wa-icon library="mdi" name="content-save"></wa-icon>
              ${this._localize("device.save")}
            </button>
          </div>
          <div class="layout-toggle" aria-label=${this._localize("device.editor_layout_label")}>
            <button
              type="button"
              aria-pressed=${effectiveLayout === "left"}
              ?disabled=${!hasBoard}
              @click=${() => this._setLayout("left")}
              title=${this._localize("device.layout_components_only")}
            >
              <wa-icon library="mdi" name="layout-left"></wa-icon>
            </button>
            <button
              class="split-btn"
              type="button"
              aria-pressed=${effectiveLayout === "both"}
              ?disabled=${!hasBoard}
              @click=${() => this._setLayout("both")}
              title=${this._localize("device.layout_split")}
            >
              <wa-icon library="mdi" name="layout-split"></wa-icon>
            </button>
            <button
              type="button"
              aria-pressed=${effectiveLayout === "right"}
              @click=${() => this._setLayout("right")}
              title=${this._localize("device.layout_yaml_only")}
            >
              <wa-icon library="mdi" name="layout-right"></wa-icon>
            </button>
          </div>
        </header>
        <div class="card-body">
          <div class=${`editor-layout ${layoutClass}`}>
            <div class="editor-pane editor-pane--left">
              <esphome-device-board-info
                .board=${this.board}
                .yaml=${this.yaml}
                .justCreated=${this.justCreated}
                .configuration=${this.configuration}
                .selectedSection=${this.selectedSection}
                .selectedFromLine=${this.selectedFromLine}
              ></esphome-device-board-info>
            </div>
            ${effectiveLayout === "both" ? html`<div class="pane-divider"></div>` : nothing}
            <div class="editor-pane editor-pane--right">
              <div class="editor-pane-body">
                <esphome-yaml-editor
                  .value=${this.yaml}
                  .highlightRange=${this.highlightRange}
                  .scrollToHighlight=${this.scrollToHighlight}
                  @yaml-change=${this._onYamlChange}
                ></esphome-yaml-editor>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  private _onSave() {
    this.dispatchEvent(
      new CustomEvent("save-yaml", {
        bubbles: true,
        composed: true,
      })
    );
  }

  private _setLayout(layout: DeviceLayoutMode) {
    this.dispatchEvent(
      new CustomEvent("layout-change", {
        detail: layout,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onYamlChange(e: CustomEvent) {
    this.dispatchEvent(
      new CustomEvent("yaml-change", {
        detail: e.detail,
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-editor": ESPHomeDeviceEditor;
  }
}
